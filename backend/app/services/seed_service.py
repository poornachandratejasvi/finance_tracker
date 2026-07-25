"""Seed per-user default categories and currencies, and backfill account currency.

Called (idempotently) on startup for every existing user and on new-user
registration, so the Wallet-style category icons/colors and the multi-currency
machinery always have data to bind to.
"""
import json
import logging

from sqlalchemy.orm import Session

from app.models.models import Category, Currency, Bank, CategoryRule, AutoRule

logger = logging.getLogger(__name__)

# Full Wallet-style category tree: parents (kept if they already exist) each with
# subcategories. icon values are keys resolved on the frontend (utils/categories.js).
CATEGORY_TREE = [
    ("Food & Dining", "Restaurant", "#e15759", "expense", [
        ("Restaurant", "Restaurant"), ("Fast food", "Fastfood"),
        ("Cafe, bar", "LocalCafe"), ("Groceries", "LocalGroceryStore")]),
    ("Shopping", "ShoppingBag", "#4e79a7", "expense", [
        ("Clothes & Footwear", "Checkroom"), ("Drug-store, chemist", "Spa"),
        ("Electronics, accessories", "Phone"), ("Home, garden", "Home"),
        ("Kids", "ChildCare"), ("Gifts, joy", "CardGiftcard"),
        ("Pets, animals", "Pets"), ("Stationery, tools", "Work"),
        ("Health and beauty", "Spa"), ("Leisure time", "SportsEsports")]),
    ("Transportation", "DirectionsBus", "#f28e2b", "expense", [
        ("Public transport", "DirectionsBus"), ("Taxi", "DirectionsCar"),
        ("Long distance", "Flight")]),
    ("Vehicle", "DirectionsCar", "#8e5ea2", "expense", [
        ("Fuel", "Bolt"), ("Parking", "DirectionsCar"),
        ("Maintenance", "Work"), ("Vehicle insurance", "ReceiptLong")]),
    ("Housing", "Home", "#e67e22", "expense", [
        ("Rent / Mortgage", "Home"), ("Energy, utilities", "Bolt"),
        ("Water", "WaterDrop"), ("Maintenance, repairs", "Work")]),
    ("Bills & Utilities", "ReceiptLong", "#af7aa1", "expense", [
        ("Phone, mobile", "Phone"), ("Internet", "Wifi"),
        ("Electricity", "Bolt"), ("TV, streaming", "Movie")]),
    ("Healthcare", "LocalHospital", "#76b7b2", "expense", [
        ("Doctor", "LocalHospital"), ("Pharmacy", "Spa"), ("Health insurance", "ReceiptLong")]),
    ("Entertainment", "Movie", "#ff9da7", "expense", [
        ("Movies", "Movie"), ("Games", "SportsEsports"),
        ("Events", "Celebration"), ("Sports, fitness", "FitnessCenter")]),
    ("Communication, PC", "Phone", "#59a14f", "expense", [
        ("Software, apps", "Wifi"), ("Phone hardware", "Phone"), ("Postal services", "Work")]),
    ("Financial expenses", "Payments", "#b07aa1", "expense", [
        ("Fees & charges", "ReceiptLong"), ("Taxes", "ReceiptLong"),
        ("Insurance", "ReceiptLong"), ("Interest paid", "TrendingUp")]),
    ("Investments", "TrendingUp", "#59a14f", "expense", [
        ("Stocks", "TrendingUp"), ("Mutual funds", "Savings"),
        ("Crypto", "TrendingUp"), ("Savings", "Savings")]),
    ("ATM Withdrawal", "LocalAtm", "#edc948", "expense", []),
    ("Transfer", "SwapHoriz", "#9c755f", "transfer", [("Between accounts", "SwapHoriz")]),
    ("Income", "Payments", "#2e9e5b", "income", [
        ("Salary", "Work"), ("Interest income", "TrendingUp"),
        ("Refunds", "SwapHoriz"), ("Gifts received", "CardGiftcard")]),
    ("Others", "MoreHoriz", "#bab0ac", "expense", []),
    ("Unknown", "HelpOutline", "#9e9e9e", "expense", []),
]

# keyword -> parent category. Matched case-insensitively against the description.
DEFAULT_CATEGORY_RULES = {
    "Food & Dining": ["SWIGGY", "ZOMATO", "RESTAURANT", "CAFE", "DOMINO", "MCDONALD", "KFC",
                       "STARBUCKS", "PIZZA", "BAKERY", "EATERY", "DHABA"],
    "Shopping": ["AMAZON", "FLIPKART", "MYNTRA", "AJIO", "MEESHO", "NYKAA", "CROMA",
                 "DMART", "BIGBASKET", "RELIANCE DIGITAL", "LIFESTYLE", "SHOPPERS STOP"],
    "Transportation": ["UBER", "OLA", "RAPIDO", "IRCTC", "METRO", "REDBUS", "RAILWAY"],
    "Vehicle": ["PETROL", "FUEL", "HPCL", "IOCL", "BPCL", "SHELL", "FASTAG", "PARKING"],
    "Bills & Utilities": ["ELECTRICITY", "BESCOM", "BROADBAND", "AIRTEL", "JIO", "VODAFONE",
                          "BSNL", "RECHARGE", "TATASKY", "DTH", "GAS BILL"],
    "Entertainment": ["NETFLIX", "SPOTIFY", "PRIMEVIDEO", "HOTSTAR", "BOOKMYSHOW", "PVR",
                      "INOX", "YOUTUBE PREMIUM"],
    "Healthcare": ["PHARMACY", "APOLLO", "HOSPITAL", "CLINIC", "1MG", "PHARMEASY", "NETMEDS",
                   "DIAGNOSTIC", "MEDPLUS"],
    "ATM Withdrawal": ["ATM", "CASH WDL", "CASH WITHDRAWAL", "ATW"],
    "Investments": ["ZERODHA", "GROWW", "UPSTOX", "KUVERA", "MUTUAL FUND", "SIP", "DEMAT"],
    "Income": ["SALARY", "SAL CREDIT", "DIVIDEND", "CASHBACK", "INTEREST CREDIT"],
    "Communication, PC": ["GOOGLE ", "MICROSOFT", "ADOBE", "GITHUB", "APPLE.COM", "OPENAI"],
    "Financial expenses": ["GST", "SERVICE CHARGE", "PROCESSING FEE", "LIC ", "INSURANCE PREMIUM", "ANNUAL FEE"],
}

# icon values are KEYS resolved to a MUI icon component on the frontend
# (frontend/src/utils/categories.js). kind: expense | income | transfer.
DEFAULT_CATEGORIES = [
    # name,                icon,            color,     kind,        sort
    ("Food & Dining",      "Restaurant",    "#e15759", "expense",   10),
    ("Shopping",           "ShoppingBag",   "#4e79a7", "expense",   20),
    ("Transportation",     "DirectionsBus", "#f28e2b", "expense",   30),
    ("Bills & Utilities",  "ReceiptLong",   "#af7aa1", "expense",   40),
    ("Entertainment",      "Movie",         "#ff9da7", "expense",   50),
    ("Healthcare",         "LocalHospital", "#76b7b2", "expense",   60),
    ("ATM Withdrawal",     "LocalAtm",      "#edc948", "expense",   70),
    ("Investments",        "TrendingUp",    "#59a14f", "expense",   80),
    ("Transfer",           "SwapHoriz",     "#9c755f", "transfer",  90),
    ("Income",             "Payments",      "#2e9e5b", "income",   100),
    ("Others",             "MoreHoriz",     "#bab0ac", "expense",  110),
    ("Unknown",            "HelpOutline",   "#9e9e9e", "expense",  120),
]

# code, symbol, name, rate_to_base, is_base
DEFAULT_CURRENCIES = [
    ("INR", "₹", "Indian Rupee",     1.0,  True),
    ("USD", "$",      "US Dollar",        83.0, False),
]


def ensure_default_categories(db: Session, user_id: int) -> int:
    """Seed default categories for a user that has none. Returns rows added."""
    existing = db.query(Category).filter(Category.user_id == user_id).count()
    if existing:
        return 0
    added = 0
    for name, icon, color, kind, sort_order in DEFAULT_CATEGORIES:
        db.add(Category(
            user_id=user_id, name=name, icon=icon, color=color,
            kind=kind, sort_order=sort_order, is_system=True,
        ))
        added += 1
    db.commit()
    return added


def ensure_default_currencies(db: Session, user_id: int) -> int:
    """Seed default currencies for a user that has none. Returns rows added."""
    existing = db.query(Currency).filter(Currency.user_id == user_id).count()
    if existing:
        return 0
    added = 0
    for code, symbol, name, rate, is_base in DEFAULT_CURRENCIES:
        db.add(Currency(
            user_id=user_id, code=code, symbol=symbol, name=name,
            rate_to_base=rate, is_base=is_base,
        ))
        added += 1
    db.commit()
    return added


def backfill_bank_currency(db: Session, user_id: int) -> int:
    """Give accounts without a currency a sensible default (USD if the name hints
    at USD/$, else INR). Returns rows updated."""
    banks = db.query(Bank).filter(
        Bank.user_id == user_id,
        (Bank.currency_code.is_(None)) | (Bank.currency_code == ""),
    ).all()
    updated = 0
    for b in banks:
        name = (b.name or "").upper()
        b.currency_code = "USD" if ("USD" in name or "$" in name) else "INR"
        updated += 1
    if updated:
        db.commit()
    return updated


def ensure_full_category_tree(db: Session, user_id: int) -> int:
    """Add any missing parent + sub categories from CATEGORY_TREE (idempotent by
    name). Existing categories are preserved; children get their parent_id set."""
    existing = {c.name: c for c in db.query(Category).filter(Category.user_id == user_id).all()}
    added = 0
    for order, (name, icon, color, kind, children) in enumerate(CATEGORY_TREE):
        parent = existing.get(name)
        if not parent:
            parent = Category(user_id=user_id, name=name, icon=icon, color=color,
                              kind=kind, sort_order=order * 100, is_system=True)
            db.add(parent); db.flush()
            existing[name] = parent
            added += 1
        for ci, (cname, cicon) in enumerate(children):
            child = existing.get(cname)
            if child:
                if child.parent_id is None:
                    child.parent_id = parent.id
                continue
            child = Category(user_id=user_id, name=cname, icon=cicon, color=color,
                             kind=kind, parent_id=parent.id,
                             sort_order=order * 100 + ci + 1, is_system=True)
            db.add(child)
            existing[cname] = child
            added += 1
    if added:
        db.commit()
    return added


def ensure_default_category_rules(db: Session, user_id: int) -> int:
    """Seed keyword->category auto-categorization rules for a user that has none."""
    if db.query(CategoryRule).filter(CategoryRule.user_id == user_id).count():
        return 0
    added = 0
    for category, keywords in DEFAULT_CATEGORY_RULES.items():
        for kw in keywords:
            db.add(CategoryRule(user_id=user_id, keyword=kw, category=category,
                                priority=len(kw), is_active=True))
            added += 1
    if added:
        db.commit()
    return added


def ensure_default_auto_rules(db: Session, user_id: int) -> int:
    """Seed Wallet-style AutoRules (one per category, keywords grouped) if none exist."""
    if db.query(AutoRule).filter(AutoRule.user_id == user_id).count():
        return 0
    added = 0
    for i, (category, keywords) in enumerate(DEFAULT_CATEGORY_RULES.items()):
        db.add(AutoRule(
            user_id=user_id, name=category, keywords=json.dumps(keywords),
            record_type="any", category=category, label_ids=json.dumps([]),
            priority=len(DEFAULT_CATEGORY_RULES) - i, is_active=True,
        ))
        added += 1
    if added:
        db.commit()
    return added


def seed_user_defaults(db: Session, user_id: int) -> None:
    """Seed everything for one user (idempotent)."""
    try:
        ensure_default_categories(db, user_id)
        ensure_full_category_tree(db, user_id)
        ensure_default_currencies(db, user_id)
        ensure_default_category_rules(db, user_id)
        ensure_default_auto_rules(db, user_id)
        backfill_bank_currency(db, user_id)
    except Exception:
        db.rollback()
        logger.warning("Failed to seed defaults for user %s", user_id, exc_info=True)
