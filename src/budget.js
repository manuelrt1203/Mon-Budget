export const categories = ['Alimentation', 'Logement', 'Transport', 'Loisirs', 'Études', 'Santé', 'Autres'];
export const defaultLimits = { Alimentation: 200, Logement: 450, Transport: 50, Loisirs: 80, Études: 40, Santé: 30, Autres: 50 };
export function summary(transactions, month) {
  const entries = transactions.filter(t => t.date.startsWith(month));
  const income = entries.filter(t => t.type === 'income').reduce((s,t) => s+t.amount,0);
  const expenses = entries.filter(t => t.type === 'expense').reduce((s,t) => s+t.amount,0);
  return { entries, income, expenses, balance: income-expenses };
}
export function validateTransaction(t) {
  return typeof t.id === 'string' && typeof t.label === 'string' && t.label.trim().length > 0 && t.label.length <= 100 && Number.isFinite(t.amount) && t.amount > 0 && ['income','expense'].includes(t.type) && categories.includes(t.category) && /^\d{4}-\d{2}-\d{2}$/.test(t.date) && !Number.isNaN(Date.parse(t.date));
}
