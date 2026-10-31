// The fixed category set. The AI is only ever allowed to answer with one of these.

export const CATEGORIES = [
  'Income',
  'Refunds & Cashback',
  'Rent & Housing',
  'Food & Dining',
  'Groceries',
  'Transport',
  'Travel',
  'Shopping',
  'Bills & Utilities',
  'Subscriptions',
  'Entertainment',
  'Health',
  'Education',
  'Personal Care',
  'EMI & Loans',
  'Insurance',
  'Investments',
  'Transfers',
  'Cash Withdrawal',
  'Fees & Charges',
  'Others',
];

export const UNCATEGORIZED = 'Uncategorized';

export const CATEGORY_SET = new Set(CATEGORIES);

export const isValidCategory = (c) => CATEGORY_SET.has(c);

/** Categories treated as fixed monthly commitments when they recur. */
export const FIXED_CATEGORIES = new Set([
  'Rent & Housing', 'EMI & Loans', 'Insurance', 'Subscriptions', 'Bills & Utilities',
]);

/** Debits in these categories are money set aside, not consumption. */
export const SAVING_CATEGORIES = new Set(['Investments']);

/** Categories a user can reasonably budget (variable spend). */
export const BUDGETABLE = CATEGORIES.filter(
  (c) => !['Income', 'Refunds & Cashback', 'Investments', 'Transfers'].includes(c),
);
