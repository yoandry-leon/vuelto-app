import { defineStore } from 'pinia';
import { ref } from 'vue';
import { seedBills, seedBudget, seedDebts, seedGoals, seedPortfolio, type Portfolio } from '@/data/seed';
import { type Account, DEFAULT_ACCOUNTS } from '@/domain/accounts';
import type { Bill } from '@/domain/bills';
import type { Budget } from '@/domain/budget';
import { todayIso } from '@/domain/dates';
import { payDebt as applyPayment, type Debt, type Movement, type SavingsGoal } from '@/domain/goals';
import type { InvestmentGoal, SimulationAssumptions } from '@/domain/investment';
import type { IsoDate } from '@/domain/types';
import { KEYS, stored } from '@/services/storage';

interface FinanzasData {
  budget: Budget;
  goals: SavingsGoal[];
  debts: Debt[];
  bills: Bill[];
  portfolio: Portfolio;
  /** Avisos de vencimiento 2 días antes (la persona los prende en Facturas). Falta en datos viejos. */
  remindersOn?: boolean;
  /** Las cuentas de las que salen los gastos. Falta en datos viejos: se usan las de siempre. */
  accounts?: Account[];
}

const db = stored<FinanzasData>(KEYS.finanzas);

function seed(): FinanzasData {
  const today = todayIso();
  return { budget: seedBudget(), goals: seedGoals(today), debts: seedDebts(today), bills: seedBills(), portfolio: seedPortfolio() };
}

/** Lo que el chat no muestra bien: presupuesto, metas de ahorro, deudas, facturas e inversión. Solo en el teléfono. */
export const useFinanzasStore = defineStore('finanzas', () => {
  const budget = ref<Budget>(seedBudget());
  const goals = ref<SavingsGoal[]>([]);
  const debts = ref<Debt[]>([]);
  const bills = ref<Bill[]>([]);
  const portfolio = ref<Portfolio>(seedPortfolio());
  const remindersOn = ref(false);
  const accounts = ref<Account[]>(DEFAULT_ACCOUNTS.map((a) => ({ ...a })));
  const loaded = ref(false);

  async function persist() {
    await db.save({
      budget: budget.value,
      goals: goals.value,
      debts: debts.value,
      bills: bills.value,
      portfolio: portfolio.value,
      remindersOn: remindersOn.value,
      accounts: accounts.value,
    });
  }

  function apply(data: FinanzasData) {
    budget.value = data.budget;
    goals.value = data.goals;
    debts.value = data.debts;
    bills.value = data.bills;
    portfolio.value = data.portfolio;
    remindersOn.value = data.remindersOn ?? false;
    accounts.value = data.accounts?.length ? data.accounts : DEFAULT_ACCOUNTS.map((a) => ({ ...a }));
  }

  async function addAccount(account: Omit<Account, 'id'>): Promise<Account> {
    const created: Account = { ...account, id: `cuenta${Date.now().toString(36)}` };
    accounts.value.push(created);
    await persist();
    return created;
  }

  async function updateAccount(id: string, patch: Partial<Omit<Account, 'id'>>) {
    const a = accounts.value.find((x) => x.id === id);
    if (!a) return;
    Object.assign(a, patch);
    await persist();
  }

  /** Borra una cuenta (nunca la última). Sus gastos quedan con la primera cuenta de su mismo tipo. */
  async function removeAccount(id: string) {
    if (accounts.value.length <= 1) return;
    accounts.value = accounts.value.filter((a) => a.id !== id);
    await persist();
  }

  async function setRemindersOn(on: boolean) {
    remindersOn.value = on;
    await persist();
  }

  async function init() {
    if (loaded.value) return;
    const data = await db.load();
    apply(data ?? seed());
    if (!data) await persist();
    loaded.value = true;
  }

  async function setBudget(next: Budget) {
    budget.value = next;
    await persist();
  }

  async function addMovement(goalId: string, movement: Movement) {
    const goal = goals.value.find((g) => g.id === goalId);
    if (!goal) return;
    goal.movements.push(movement);
    await persist();
  }

  /** Crea una meta de ahorro. Lo que ya estaba ahorrado entra como su primer aporte. */
  async function addGoal(goal: Omit<SavingsGoal, 'id' | 'movements'>, alreadySaved = 0, today: IsoDate = todayIso()): Promise<SavingsGoal> {
    const created: SavingsGoal = {
      ...goal,
      id: `meta${Date.now().toString(36)}`,
      movements: alreadySaved > 0 ? [{ date: today, amount: alreadySaved, note: 'Lo que ya tenías ahorrado' }] : [],
    };
    goals.value.push(created);
    await persist();
    return created;
  }

  /** Crea una meta de inversión y deja la simulación de Inversión mostrando esa meta con sus supuestos. */
  async function addInvestmentGoal(goal: Omit<InvestmentGoal, 'id'>, simulation: SimulationAssumptions) {
    const id = `inv${Date.now().toString(36)}`;
    portfolio.value.goals.push({ ...goal, id });
    portfolio.value.simulation = { ...simulation, goalId: id };
    await persist();
  }

  async function updateGoal(goalId: string, patch: Partial<Pick<SavingsGoal, 'name' | 'target' | 'monthly' | 'where'>>) {
    const goal = goals.value.find((g) => g.id === goalId);
    if (!goal) return;
    Object.assign(goal, patch);
    await persist();
  }

  async function payDebt(debtId: string, amount: number) {
    debts.value = debts.value.map((d) => (d.id === debtId ? applyPayment(d, amount) : d));
    await persist();
  }

  /** Marca la factura del mes como pagada. Con `amount`, ese es el monto del mes (y en una variable, el nuevo estimado). */
  async function markBillPaid(billId: string, month: string, date: IsoDate, method?: string, amount?: number) {
    const bill = bills.value.find((b) => b.id === billId);
    if (!bill) return;
    bill.paid = { ...bill.paid, [month]: { date, method } };
    if (amount !== undefined && amount > 0) setMonthAmount(bill, month, amount);
    await persist();
  }

  function setMonthAmount(bill: Bill, month: string, amount: number) {
    if (amount === bill.amount && !bill.amounts?.[month]) return;
    bill.amounts = { ...bill.amounts, [month]: amount };
    if (bill.variable) bill.amount = amount;
  }

  /** El monto real de este mes de una factura (la luz llegó por $ 2.380). */
  async function setBillAmount(billId: string, month: string, amount: number) {
    const bill = bills.value.find((b) => b.id === billId);
    if (!bill || !(amount > 0)) return;
    setMonthAmount(bill, month, amount);
    await persist();
  }

  async function addBill(bill: Omit<Bill, 'id' | 'paid'>): Promise<Bill> {
    const created: Bill = { ...bill, id: `factura${Date.now().toString(36)}`, paid: {} };
    bills.value.push(created);
    await persist();
    return created;
  }

  async function updateBill(billId: string, patch: Partial<Omit<Bill, 'id' | 'paid' | 'amounts'>>) {
    const bill = bills.value.find((b) => b.id === billId);
    if (!bill) return;
    Object.assign(bill, patch);
    if (!patch.variable && patch.variable !== undefined) delete bill.variable;
    await persist();
  }

  async function removeBill(billId: string) {
    bills.value = bills.value.filter((b) => b.id !== billId);
    await persist();
  }

  async function unmarkBillPaid(billId: string, month: string) {
    const bill = bills.value.find((b) => b.id === billId);
    if (!bill) return;
    const { [month]: _removed, ...rest } = bill.paid;
    bill.paid = rest;
    await persist();
  }

  async function setSimulation(s: SimulationAssumptions) {
    portfolio.value.simulation = { ...portfolio.value.simulation, ...s };
    await persist();
  }

  async function setHoldingValue(holdingId: string, valueUsd: number) {
    const h = portfolio.value.holdings.find((x) => x.id === holdingId);
    if (!h) return;
    h.valueUsd = valueUsd;
    await persist();
  }

  async function resetDemo() {
    apply(seed());
    await persist();
  }

  return {
    budget, goals, debts, bills, portfolio, remindersOn, accounts, loaded, addAccount, updateAccount, removeAccount,
    init, setBudget, addMovement, addGoal, addInvestmentGoal, updateGoal, payDebt, markBillPaid, unmarkBillPaid, setBillAmount, addBill, updateBill, removeBill, setSimulation, setHoldingValue, setRemindersOn, resetDemo,
  };
});
