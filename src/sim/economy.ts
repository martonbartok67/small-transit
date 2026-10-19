import { CONFIG } from './config';
import type { CompanyUpgrade, Ledger, Mode } from './types';

export const emptyLedger = (): Ledger => ({ fares: 0, freight: 0, running: 0, maintenance: 0, interest: 0, construction: 0, vehicles: 0, away: 0 });

/** Company finances: cash, loan, a ledger for this month and last, and the bankruptcy rule. */
export class Economy {
  cash = CONFIG.startCash;
  loan = 0;
  month: Ledger = emptyLedger();
  last: Ledger = emptyLedger();
  /** This calendar year so far, and the whole of last year. */
  year: Ledger = emptyLedger();
  lastYear: Ledger = emptyLedger();
  /** Cash, net result and operating profit (before building and buying) at each month end, oldest first (last 36 months). */
  history: { cash: number; net: number; operating: number }[] = [];
  negativeMonths = 0;
  /** Ticket price level per mode, 1 = list price. */
  price: Record<Mode, number> = { rail: 1, road: 1 };
  /** Company-wide upgrade levels, 0 to CONFIG.maxUpgrade. */
  upgrades: Record<CompanyUpgrade, number> = { workshop: 0, marketing: 0, brokerage: 0, service: 0 };

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

  /** Demand multiplier at the current price for a mode: cheaper tickets, more riders; marketing adds more. */
  demand(mode: Mode): number {
    return Math.pow(this.price[mode], -CONFIG.price.elasticity) * (1 + CONFIG.upgrades.marketing * this.upgrades.marketing);
  }

  /** What time away is worth: a share of last month's operating profit per hour, capped; nothing after a losing month. */
  awayIncome(hours: number): number {
    const { share, maxHours } = CONFIG.away;
    const op = Economy.operating(this.last);
    if (op <= 0 || hours <= 0) return 0;
    return op * share * Math.min(maxHours, hours);
  }

  creditAway(amount: number): void {
    this.cash += amount;
    this.month.away += amount;
  }

  /** Close the month. Returns true when the company is bankrupt. */
  closeMonth(): boolean {
    this.charge('interest', (this.loan * CONFIG.interestPerYear) / 12);
    this.last = this.month;
    this.month = emptyLedger();
    for (const k of Object.keys(this.year) as (keyof Ledger)[]) this.year[k] += this.last[k];
    this.history.push({ cash: this.cash, net: Economy.net(this.last), operating: Economy.operating(this.last) });
    if (this.history.length > 36) this.history.shift();
    this.negativeMonths = this.cash < 0 ? this.negativeMonths + 1 : 0;
    return this.negativeMonths >= CONFIG.bankruptMonths;
  }

  /** Start a new calendar year. */
  closeYear(): void {
    this.lastYear = this.year;
    this.year = emptyLedger();
  }

  /** Income less running costs: the business result before construction and vehicle purchases. */
  static operating(l: Ledger): number {
    return l.fares + l.freight + l.running + l.maintenance + l.interest;
  }

  static net(l: Ledger): number {
    return l.fares + l.freight + l.running + l.maintenance + l.interest + l.construction + l.vehicles + l.away;
  }
}
