import hashlib
from typing import List, Optional, Dict
from sqlalchemy.orm import Session
from sqlalchemy import and_, or_, func
from datetime import datetime
import logging

from app.models.models import Transaction, TransactionType
from app.schemas.transaction import TransactionCreate

logger = logging.getLogger(__name__)


class TransactionService:
    """Service for transaction operations"""
    
    @staticmethod
    def generate_transaction_hash(transaction: Dict) -> str:
        """Generate unique hash for transaction to detect duplicates"""
        # Create hash from transaction details
        date_value = transaction.get('transaction_date')
        if hasattr(date_value, 'date'):
            date_value = date_value.date()
        description = (transaction.get('description') or '').strip().lower()
        hash_string = f"{date_value}_{transaction.get('amount')}_{description}"
        # SHA-256 (truncated to fit the duplicate_group_id column). Not security-sensitive,
        # but avoids the broken MD5 primitive.
        return hashlib.sha256(hash_string.encode()).hexdigest()[:32]
    
    @staticmethod
    def find_duplicates(
        db: Session,
        user_id: int,
        transactions: List[Dict],
        tolerance_days: int = 0,
        amount_tolerance: float = 0.0
    ) -> Dict[str, List[int]]:
        """
        Find duplicate transactions
        
        Args:
            db: Database session
            user_id: User ID
            transactions: List of transactions to check
            tolerance_days: Days tolerance for date matching
            amount_tolerance: Amount tolerance for matching
        
        Returns:
            Dictionary mapping duplicate_group_id to list of transaction IDs
        """
        duplicate_groups = {}
        
        for trans in transactions:
            # Search for potential duplicates
            trans_date = trans.get('transaction_date')
            amount = trans.get('amount')
            
            if not trans_date or amount is None or not hasattr(trans_date, 'date'):
                continue
            
            description = (trans.get('description') or '').strip()

            # Query existing transactions using exact match on date, amount, description
            existing = db.query(Transaction).filter(
                and_(
                    Transaction.user_id == user_id,
                    func.date(Transaction.transaction_date) == trans_date.date(),
                    Transaction.amount == amount,
                    func.lower(Transaction.description) == description.lower()
                )
            ).all()
            
            if existing:
                # Generate group ID
                group_id = TransactionService.generate_transaction_hash({
                    'transaction_date': trans_date.date(),
                    'amount': amount,
                    'description': description
                })
                
                trans_ids = [t.id for t in existing]
                duplicate_groups[group_id] = trans_ids
        
        return duplicate_groups
    
    @staticmethod
    def mark_duplicates(
        db: Session,
        duplicate_groups: Dict[str, List[int]]
    ) -> int:
        """Mark transactions as duplicates"""
        count = 0
        
        for group_id, trans_ids in duplicate_groups.items():
            if len(trans_ids) > 1:
                # Mark all transactions in group as duplicates
                db.query(Transaction).filter(
                    Transaction.id.in_(trans_ids)
                ).update(
                    {
                        'is_duplicate': True,
                        'duplicate_group_id': group_id
                    },
                    synchronize_session=False
                )
                count += len(trans_ids)
        
        db.commit()
        return count
    
    @staticmethod
    def apply_auto_labels(
        db: Session,
        transaction_id: int,
        description: str
    ) -> int:
        """Apply auto-labeling rules to transaction (scoped to the transaction's owner)."""
        from app.models.models import AutoLabelRule, TransactionLabel, Label

        txn = db.query(Transaction).filter(Transaction.id == transaction_id).first()
        if not txn:
            return 0

        # Only this user's rules — never apply another user's rules/labels to their data.
        rules = (
            db.query(AutoLabelRule)
            .join(Label, AutoLabelRule.label_id == Label.id)
            .filter(
                AutoLabelRule.is_active == True,  # noqa: E712
                Label.user_id == txn.user_id,
            )
            .all()
        )

        labels_added = 0
        
        for rule in rules:
            # Check if keyword matches description
            if rule.keyword.lower() in description.lower():
                # Check if label already applied
                existing = db.query(TransactionLabel).filter(
                    and_(
                        TransactionLabel.transaction_id == transaction_id,
                        TransactionLabel.label_id == rule.label_id
                    )
                ).first()
                
                if not existing:
                    # Add label
                    trans_label = TransactionLabel(
                        transaction_id=transaction_id,
                        label_id=rule.label_id
                    )
                    db.add(trans_label)
                    labels_added += 1
        
        if labels_added > 0:
            db.commit()
        
        return labels_added
    
    @staticmethod
    def categorize_transaction(description: str) -> Optional[str]:
        """Best-effort auto-categorize from a hardcoded keyword list. Returns None
        (not 'Others') when nothing matches -- an honest "not categorized yet" that
        renders as "Uncategorized" and is still picked up by every "needs
        categorization" sweep (AI Categorize, Apply Rules), same as a NULL category
        from any other path (e.g. Gmail alert emails, which never call this at all).
        Previously this returned the literal string 'Others' unconditionally,
        permanently mislabeling any transaction whose merchant isn't one of the ~8
        keyword buckets below (most real-world merchants) as if it had been
        deliberately categorized, instead of leaving it visibly unclassified."""
        categories = {
            'Food & Dining': ['restaurant', 'food', 'zomato', 'swiggy', 'cafe', 'pizza', 'burger'],
            'Shopping': ['amazon', 'flipkart', 'myntra', 'shopping', 'mall', 'store'],
            'Transportation': ['uber', 'ola', 'metro', 'fuel', 'petrol', 'parking'],
            'Bills & Utilities': ['electricity', 'water', 'gas', 'mobile', 'internet', 'bill'],
            'Entertainment': ['movie', 'netflix', 'prime', 'spotify', 'game'],
            'Healthcare': ['hospital', 'pharmacy', 'medical', 'doctor', 'clinic'],
            'Transfer': ['upi', 'imps', 'neft', 'rtgs', 'transfer'],
            'ATM Withdrawal': ['atm', 'withdrawal', 'cash'],
        }

        description_lower = description.lower()

        for category, keywords in categories.items():
            if any(keyword in description_lower for keyword in keywords):
                return category

        return None


