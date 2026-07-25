# Project Status: Requirement Enhancement & Validation Plan

## 🛠 1. Infrastructure & System Integrity
| ID | Requirement | Technical Implementation | Validation / Test Case (Pass Criteria) |
|:---|:---|:---|:---|
| **1.1** | **Docker Logs** | Global error handling and logging to `stdout`. | `docker compose logs` shows no 500/404 errors during startup. |
| **1.2** | **Build & Validate** | Multi-stage build with health checks. | `docker ps` shows all containers as "Healthy". |
| **1.3** | **Knowledge Base** | Maintain `docs/architecture.md` and `docs/api_spec.json`. | AI can reference file to explain any logic change. |

## 📊 2. Analytics & Dashboard (UI/UX)
| ID | Requirement | Technical Implementation | Validation / Test Case (Pass Criteria) |
|:---|:---|:---|:---|
| **2.1** | **Correct View** | Default route must point to Financial Overview. | Landing page != "Analytics Only"; must show summary stats. |
| **2.2** | **Dark Mode Fix** | CSS Variable Audit for `.balance-card`. | Contrast ratio > 4.5:1 on dark background. |
| **2.3** | **Income Logic** | Logic: `SUM(amount)` where `type == 'CREDIT'`. | Dashboard "Total Income" matches DB query exactly. |
| **2.4** | **Bank Balances** | Logic: `Last_Balance + SUM(Transactions)`. | "Balances" section displays non-zero, real-time data. |

## 🏷️ 3. Transaction & Label Engine
| ID | Requirement | Technical Implementation | Validation / Test Case (Pass Criteria) |
|:---|:---|:---|:---|
| **3.1** | **Label CRUD** | Implement `DELETE`, `PATCH`, and `POST` for labels. | Label is removed from DB and UI immediately on click. |
| **3.2** | **Multi-Labeling** | Update Schema: `transactions` <-> `transaction_labels` (M2M). | One transaction can store N labels; labels persist in future. |
| **3.3** | **Auto-Keywords** | Regex-based matching engine for incoming descriptions. | Adding keyword "Starbucks" triggers prompt to tag all matches. |
| **3.4** | **Bulk Selection** | UI "Select All" checkbox for keyword matches. | User can tag 50 transactions with one click. |

## 📧 4. Automations & Integrations
| ID | Requirement | Technical Implementation | Validation / Test Case (Pass Criteria) |
|:---|:---|:---|:---|
| **4.1** | **Bank Editing** | Add `UpdateBank` API endpoint and Edit Modal. | User can rename bank or change initial balance. |
| **4.2** | **Email Export** | Integration with Nodemailer/SendGrid for CSV. | `POST /export/email` sends file to user-configured address. |
| **4.3** | **Gmail Fetcher** | Cron service with configurable intervals (Default 2h). | Logs show successful fetch every 2 hours without manual trigger. |

## 📄 5. PDF/CSV Processing Logic
| ID | Requirement | Technical Implementation | Validation / Test Case (Pass Criteria) |
|:---|:---|:---|:---|
| **5.1** | **Column Mapping** | Flexible parser for Income/Expense/Combined columns. | Correctly parses `+` and `-` symbols in a single column. |
| **5.2** | **Bulk PDF** | Iterate through array of File IDs for CSV conversion. | Selecting 5 PDFs generates 5 corresponding CSV rows. |
| **5.3** | **Storage Policy** | Cleanup script based on `MAX_FILE_COUNT` or `MAX_SIZE`. | Oldest CSVs deleted when storage exceeds configured limit. |
| **5.4** | **PDF Recovery** | Decrypt and store PDFs locally post-Gmail fetch. | `Detected PDF Columns` UI populates data from stored files. |

## 🧪 6. Quality Assurance (QA)
- **UI Testing Framework:** Integration of Playwright/Cypress for E2E testing.
- **Backend Testing:** Jest/Pytest for API endpoint validation.
- **Regression:** All transactions must be re-scanned if core parsing logic changes.