import { CONFIG } from './config';
import type { Ledger, Mode } from './types';

const emptyLedger = (): Ledger => ({ fares: 0, freight: 0, running: 0, maintenance: 0, interest: 0, construction: 0, vehicles: 0 });

/** Company finances: cash, loan, a ledger for this month and last, and the bankruptcy rule. */
export class Economy {
  cash = CONFIG.startCash;
  loan = 0;
  month: Ledger = emptyLedger();
  last: Ledger = emptyLedger();
  negativeMonths = 0;
  /** Ticket price level per mode, 1 = list price. */
  price: Record<Mode, number> = { rail: 1, road: 1 };

  /** One-off spending the player chooses; refused when cash would go negative. */
  spend(kind: 'construction' | 'vehicles', amount: number): boolean {
    if (amount > this.cash) return false;
    this.cash -= amount;
    this.month[kind] -= amount;
    return true;
  }

  /** Running costs that are charged regardless of cash. */
  charge(kind: 'running' | 'maintenance' | 'interest', amount: number): void {
    this.cash -= amount;
    this.month[kind] -= amount;
  }

  earn(kind: 'fares' | 'freight', amount: number): void {
    this.cash += amount;
    this.month[kind] += amount;
  }

  refund(amount: number): void {
    this.cash += amount;
    this.month.vehicles += amount;
  }

  borrow(): boolean {
    const step = Math.min(CONFIG.loanStep, CONFIG.maxLoan - this.loan);
    if (step <= 0) return false;
    this.loan += step;
    this.cash += step;
    return true;
  }

  repay(): boolean {
    const step = Math.min(CONFIG.loanStep, this.loan, Math.max(0, this.cash));
    if (step <= 0) return false;
    this.loan -= step;
    this.cash -= step;
    return true;
  }

  setPrice(mode: Mode, level: number): void {
    const { min, max, step } = CONFIG.price;
    this.price[mode] = Math.min(max, Math.max(min, Math.round(level / step) * step));
  }

  /** Demand multiplier at the current price for a mode: cheaper tickets, more riders. */
  demand(mode: Mode): number {
    return Math.pow(this.price[mode], -CONFIG.price.elasticity);
  }

  /** Close the month. Returns true when the company is bankrupt. */
  closeMonth(): boolean {
    this.charge('interest', (this.loan * CONFIG.interestPerYear) / 12);
    this.last = this.month;
    this.month = emptyLedger();
    this.negativeMonths = this.cash < 0 ? this.negativeMonths + 1 : 0;
    return this.negativeMonths >= CONFIG.bankruptMonths;
  }

  static net(l: Ledger): number {
    return l.fares + l.freight + l.running + l.maintenance + l.interest + l.construction + l.vehicles;
  }
}
