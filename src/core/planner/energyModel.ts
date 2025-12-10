import { config } from '../../infra/config/config.js';
import { createLogger } from '../../infra/logger/logger.js';

const logger = createLogger(config);

export interface EnergyState {
  value: number; // 0 ~ 1
  lastUpdate: number; // timestamp ms
}

export class EnergyModel {
  private state: EnergyState = { value: 1, lastUpdate: Date.now() };
  private recoveryPerMinute = 0.05; // recover 0.02 per minute
  private costPerReply = 0.1; // spend 0.10 per reply

  private tick(): void {
    const now = Date.now();
    const dtMinutes = (now - this.state.lastUpdate) / 60000;
    if (dtMinutes > 0) {
      this.state.value = Math.min(1, this.state.value + dtMinutes * this.recoveryPerMinute);
      this.state.lastUpdate = now;
    }
  }

  getEnergy(): number {
    this.tick();
    logger.debug('planner', `Energy: ${(this.state.value * 100).toFixed(0)}%`);
    return this.state.value;
  }

  onReplySent(cost: number = this.costPerReply): void {
    this.tick();
    this.state.value = Math.max(0, this.state.value - cost);
    logger.debug(
      'planner',
      `Energy spent: ${(cost * 100).toFixed(0)}% (now ${(this.state.value * 100).toFixed(0)}%)`,
    );
  }

  setRecoveryRate(perMinute: number): void {
    this.recoveryPerMinute = perMinute;
  }

  setCostPerReply(cost: number): void {
    this.costPerReply = cost;
  }
}

// Global singleton for now
export const globalEnergyModel = new EnergyModel();
