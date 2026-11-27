// Copyright 2026 Awesome-OS Contributors
// SPDX-License-Identifier: BSD-3-Clause
/**
 * @file arch/pdp11/pdp11-demo.mts
 * @description Self-contained clean-room DEC PDP-11/40 CPU, UNIBUS MMIO
 * Task Manager telemetry monitor, octal assembler, and CLI demo runner.
 * Strictly `erasableSyntaxOnly: true`, zero external dependencies.
 */

export const B8G_PDP11_ABI_MAGIC = 0x31315044; /* "PD11" */
export const B8G_PDP11_ABI_VERSION = 1;
export const B8G_ABI_MAGIC_V3 = 0x33564742; /* "BGV3" */
export const B8G_PDP11_RAM_BYTES = 65536;
export const B8G_PDP11_TX_CAP = 64;
export const B8G_PDP11_TM_REG_COUNT = 8;

/* UNIBUS I/O page MMIO addresses (octal) */
export const B8G_PDP11_MMIO_TM_BASE = 0o177000;
export const B8G_PDP11_MMIO_TM_CPU = 0o177000;
export const B8G_PDP11_MMIO_TM_MEM = 0o177002;
export const B8G_PDP11_MMIO_TM_PROC = 0o177004;
export const B8G_PDP11_MMIO_TM_SELF = 0o177006;
export const B8G_PDP11_MMIO_TM_SEQ = 0o177010;

export const B8G_PDP11_KL11_XCSR = 0o177564;
export const B8G_PDP11_KL11_XBUF = 0o177566;
export const B8G_PDP11_SWITCH_REG = 0o177570;

export const PDP11_PSW_C = 0x0001;
export const PDP11_PSW_V = 0x0002;
export const PDP11_PSW_Z = 0x0004;
export const PDP11_PSW_N = 0x0008;

export interface Pdp11StateSnapshot {
  readonly regs: readonly number[];
  readonly octalRegs: {
    readonly R0: string;
    readonly R1: string;
    readonly R2: string;
    readonly R3: string;
    readonly R4: string;
    readonly R5: string;
    readonly SP: string;
    readonly PC: string;
    readonly PSW: string;
    readonly SWITCH: string;
    readonly DISPLAY: string;
  };
  readonly psw: number;
  readonly flags: {
    readonly N: boolean;
    readonly Z: boolean;
    readonly V: boolean;
    readonly C: boolean;
  };
  readonly halted: boolean;
  readonly lastFault: number;
  readonly cycleCount: number;
  readonly switchReg: number;
  readonly displayReg: number;
  readonly txText: string;
  readonly mmioTmRegs: readonly number[];
}

export interface AssembledProgram {
  readonly origin: number;
  readonly words: readonly number[];
  readonly labels: Readonly<Record<string, number>>;
}

interface OperandRef {
  isReg: boolean;
  regIdx: number;
  addr: number;
}

export function octal16(value: number): string {
  return ((value & 0xffff) >>> 0).toString(8).padStart(6, '0');
}

export function bits16String(value: number, onChar = '●', offChar = '○'): string {
  const v = value & 0xffff;
  const groups: string[] = [(v & 0x8000) !== 0 ? onChar : offChar];
  for (let shift = 12; shift >= 0; shift -= 3) {
    let g = '';
    for (let b = 2; b >= 0; b--) {
      g += (v & (1 << (shift + b))) !== 0 ? onChar : offChar;
    }
    groups.push(g);
  }
  return groups.join(' ');
}

export class Pdp11Machine {
  readonly regs = new Uint16Array(8);
  readonly mmioTmRegs = new Uint16Array(B8G_PDP11_TM_REG_COUNT);
  readonly txBuf = new Uint8Array(B8G_PDP11_TX_CAP);
  readonly ram = new Uint8Array(B8G_PDP11_RAM_BYTES);

  psw = 0;
  halted = false;
  lastFault = 0;
  cycleCount = 0;
  txLen = 0;
  txTotal = 0;
  switchReg = 0;
  displayReg = 0;
  txText = '';

  constructor(startPc = 0o001000) {
    this.reset(startPc);
  }

  reset(startPc = 0o001000): void {
    this.regs.fill(0);
    this.mmioTmRegs.fill(0);
    this.txBuf.fill(0);
    this.ram.fill(0);
    this.regs[6] = 0o000700;
    this.regs[7] = startPc & 0xffff;
    this.psw = 0;
    this.halted = false;
    this.lastFault = 0;
    this.cycleCount = 0;
    this.txLen = 0;
    this.txTotal = 0;
    this.switchReg = 0;
    this.displayReg = 0;
    this.txText = '';
  }

  loadWords(baseAddr: number, words: ArrayLike<number>): void {
    const base = baseAddr & 0xffff;
    if ((base & 1) !== 0 || base + words.length * 2 > B8G_PDP11_RAM_BYTES) {
      throw new RangeError(`Invalid PDP-11 load range at ${octal16(baseAddr)}`);
    }
    for (let i = 0; i < words.length; i++) {
      this.writeRam16((base + i * 2) & 0xffff, words[i] & 0xffff);
    }
  }

  loadProgram(program: AssembledProgram, setPc = true): void {
    this.loadWords(program.origin, program.words);
    if (setPc) {
      this.regs[7] = program.origin & 0xffff;
      this.halted = false;
    }
  }

  injectTelemetry(
    cpuPctX10: number,
    memPctX10: number,
    procCount: number,
    selfCpuUs: number,
    sampleSeq: number,
  ): void {
    const vals = [
      Math.max(0, Math.min(0xffff, Math.round(cpuPctX10))),
      Math.max(0, Math.min(0xffff, Math.round(memPctX10))),
      Math.max(0, Math.min(0xffff, Math.round(procCount))),
      Math.max(0, Math.min(0xffff, Math.round(selfCpuUs))),
      Math.max(0, Math.min(0xffff, Math.round(sampleSeq))),
    ];
    for (let i = 0; i < vals.length; i++) {
      this.mmioTmRegs[i] = vals[i];
      this.writeRam16((B8G_PDP11_MMIO_TM_BASE + i * 2) & 0xffff, vals[i]);
    }
  }

  read16(addr: number): number {
    return this.busRead16(addr & 0xffff);
  }

  write16(addr: number, val: number): void {
    this.busWrite16(addr & 0xffff, val & 0xffff);
  }

  private readRam16(addr: number): number {
    const a0 = addr & 0xfffe;
    return this.ram[a0] | (this.ram[(a0 + 1) & 0xffff] << 8);
  }

  private writeRam16(addr: number, val: number): void {
    const a0 = addr & 0xfffe;
    this.ram[a0] = val & 0xff;
    this.ram[(a0 + 1) & 0xffff] = (val >> 8) & 0xff;
  }

  private busRead16(addr: number): number {
    const even = addr & 0xfffe;
    if (even >= B8G_PDP11_MMIO_TM_BASE && even < B8G_PDP11_MMIO_TM_BASE + B8G_PDP11_TM_REG_COUNT * 2) {
      return this.mmioTmRegs[(even - B8G_PDP11_MMIO_TM_BASE) >> 1];
    }
    if (even === B8G_PDP11_KL11_XCSR) return 0x0080;
    if (even === B8G_PDP11_KL11_XBUF) return 0x0000;
    if (even === B8G_PDP11_SWITCH_REG) return this.switchReg;
    return this.readRam16(even);
  }

  private busRead8(addr: number): number {
    const a = addr & 0xffff;
    if (a >= B8G_PDP11_MMIO_TM_BASE && a < 0xff00) {
      const w = this.busRead16(a & 0xfffe);
      return (a & 1) !== 0 ? (w >> 8) & 0xff : w & 0xff;
    }
    if ((a & 0xfffe) === B8G_PDP11_KL11_XCSR) return (a & 1) !== 0 ? 0x00 : 0x80;
    if ((a & 0xfffe) === B8G_PDP11_SWITCH_REG) {
      return (a & 1) !== 0 ? (this.switchReg >> 8) & 0xff : this.switchReg & 0xff;
    }
    return this.ram[a];
  }

  private kl11TxByte(ch: number): void {
    const byte = ch & 0xff;
    if (this.txLen < B8G_PDP11_TX_CAP) {
      this.txBuf[this.txLen++] = byte;
    } else {
      this.txBuf[this.txTotal % B8G_PDP11_TX_CAP] = byte;
    }
    this.txTotal++;
    this.txText += String.fromCharCode(byte);
  }

  private busWrite16(addr: number, val: number): void {
    const even = addr & 0xfffe;
    const v = val & 0xffff;
    if (even === B8G_PDP11_KL11_XBUF) {
      this.kl11TxByte(v & 0xff);
      this.writeRam16(even, v);
      return;
    }
    if (even === B8G_PDP11_KL11_XCSR) {
      this.writeRam16(even, v | 0x0080);
      return;
    }
    if (even === B8G_PDP11_SWITCH_REG) {
      this.displayReg = v;
      this.writeRam16(even, v);
      return;
    }
    if (even >= B8G_PDP11_MMIO_TM_BASE && even < B8G_PDP11_MMIO_TM_BASE + B8G_PDP11_TM_REG_COUNT * 2) {
      this.mmioTmRegs[(even - B8G_PDP11_MMIO_TM_BASE) >> 1] = v;
    }
    this.writeRam16(even, v);
  }

  private busWrite8(addr: number, val: number): void {
    const a = addr & 0xffff;
    const b = val & 0xff;
    if ((a & 0xfffe) === B8G_PDP11_KL11_XBUF) {
      if ((a & 1) === 0) this.kl11TxByte(b);
      this.ram[a] = b;
      return;
    }
    if ((a & 0xfffe) === B8G_PDP11_SWITCH_REG) {
      this.displayReg = (a & 1) === 0
        ? (this.displayReg & 0xff00) | b
        : (this.displayReg & 0x00ff) | (b << 8);
      this.ram[a] = b;
      return;
    }
    this.ram[a] = b;
  }

  private fetchWord(): number {
    const pc = this.regs[7];
    const w = this.readRam16(pc);
    this.regs[7] = (pc + 2) & 0xffff;
    return w;
  }

  private resolveOperand(field: number, isByte: boolean): OperandRef {
    const mode = (field >> 3) & 7;
    const reg = field & 7;
    const step = isByte && reg < 6 ? 1 : 2;
    const op: OperandRef = { isReg: false, regIdx: reg, addr: 0 };

    switch (mode) {
      case 0:
        op.isReg = true;
        break;
      case 1:
        op.addr = this.regs[reg];
        break;
      case 2:
        op.addr = this.regs[reg];
        this.regs[reg] = (this.regs[reg] + step) & 0xffff;
        break;
      case 3: {
        const ptr = this.regs[reg];
        this.regs[reg] = (this.regs[reg] + 2) & 0xffff;
        op.addr = this.busRead16(ptr);
        break;
      }
      case 4:
        this.regs[reg] = (this.regs[reg] - step) & 0xffff;
        op.addr = this.regs[reg];
        break;
      case 5:
        this.regs[reg] = (this.regs[reg] - 2) & 0xffff;
        op.addr = this.busRead16(this.regs[reg]);
        break;
      case 6: {
        const disp = this.fetchWord();
        op.addr = (this.regs[reg] + disp) & 0xffff;
        break;
      }
      case 7: {
        const disp = this.fetchWord();
        op.addr = this.busRead16((this.regs[reg] + disp) & 0xffff);
        break;
      }
    }
    return op;
  }

  private readOperand(op: OperandRef, isByte: boolean): number {
    if (op.isReg) {
      const v = this.regs[op.regIdx];
      return isByte ? v & 0xff : v;
    }
    return isByte ? this.busRead8(op.addr) : this.busRead16(op.addr);
  }

  private writeOperand(op: OperandRef, val: number, isByte: boolean, signExtendRegByte: boolean): void {
    if (op.isReg) {
      if (isByte) {
        const b = val & 0xff;
        this.regs[op.regIdx] = signExtendRegByte
          ? ((b & 0x80) !== 0 ? 0xff00 | b : b)
          : ((this.regs[op.regIdx] & 0xff00) | b);
      } else {
        this.regs[op.regIdx] = val & 0xffff;
      }
      return;
    }
    if (isByte) {
      this.busWrite8(op.addr, val & 0xff);
    } else {
      this.busWrite16(op.addr, val & 0xffff);
    }
  }

  private setNz(val: number, isByte: boolean, keepC: boolean, cVal: boolean, vVal: boolean): void {
    const masked = isByte ? val & 0xff : val & 0xffff;
    const signBit = isByte ? 0x0080 : 0x8000;
    let psw = this.psw & ~(PDP11_PSW_N | PDP11_PSW_Z | PDP11_PSW_V | (keepC ? 0 : PDP11_PSW_C));
    if ((masked & signBit) !== 0) psw |= PDP11_PSW_N;
    if (masked === 0) psw |= PDP11_PSW_Z;
    if (vVal) psw |= PDP11_PSW_V;
    if (!keepC && cVal) psw |= PDP11_PSW_C;
    this.psw = psw;
  }

  private branchCond(code: number): boolean {
    const n = (this.psw & PDP11_PSW_N) !== 0;
    const z = (this.psw & PDP11_PSW_Z) !== 0;
    const v = (this.psw & PDP11_PSW_V) !== 0;
    const c = (this.psw & PDP11_PSW_C) !== 0;
    switch (code) {
      case 0x01: return true;
      case 0x02: return !z;
      case 0x03: return z;
      case 0x04: return n === v;
      case 0x05: return n !== v;
      case 0x06: return !z && n === v;
      case 0x07: return z || n !== v;
      case 0x80: return !n;
      case 0x81: return n;
      case 0x82: return !c && !z;
      case 0x83: return c || z;
      case 0x84: return !v;
      case 0x85: return v;
      case 0x86: return !c;
      case 0x87: return c;
      default: return false;
    }
  }

  step(): boolean {
    if (this.halted) return false;
    const op = this.fetchWord();
    this.cycleCount++;

    if (op === 0o000000) {
      this.halted = true;
      return false;
    }
    if (op === 0o000001) return true;
    if (op === 0o000005) {
      this.lastFault = 0;
      this.txLen = 0;
      this.txTotal = 0;
      this.txText = '';
      return true;
    }
    if ((op & 0xfff0) === 0x00a0) {
      this.psw &= ~(op & 0x000f);
      return true;
    }
    if ((op & 0xfff0) === 0x00b0) {
      this.psw |= op & 0x000f;
      return true;
    }
    if ((op & 0xfff8) === 0x0080) {
      const reg = op & 7;
      this.regs[7] = this.regs[reg];
      this.regs[reg] = this.busRead16(this.regs[6]);
      this.regs[6] = (this.regs[6] + 2) & 0xffff;
      return true;
    }
    if ((op & 0xffc0) === 0x0040) {
      const dst = this.resolveOperand(op & 0x3f, false);
      if (dst.isReg) {
        this.lastFault = op;
        this.halted = true;
        return false;
      }
      this.regs[7] = dst.addr;
      return true;
    }
    if ((op & 0xffc0) === 0x00c0) {
      const dst = this.resolveOperand(op & 0x3f, false);
      const v = this.readOperand(dst, false);
      const res = ((v & 0x00ff) << 8) | ((v >> 8) & 0x00ff);
      this.writeOperand(dst, res, false, false);
      this.setNz(res & 0xff, true, false, false, false);
      return true;
    }
    if ((op & 0xfe00) === 0x0800) {
      const reg = (op >> 6) & 7;
      const dst = this.resolveOperand(op & 0x3f, false);
      if (dst.isReg) {
        this.lastFault = op;
        this.halted = true;
        return false;
      }
      this.regs[6] = (this.regs[6] - 2) & 0xffff;
      this.busWrite16(this.regs[6], this.regs[reg]);
      this.regs[reg] = this.regs[7];
      this.regs[7] = dst.addr;
      return true;
    }
    if ((op & 0xfe00) === 0x7e00) {
      const reg = (op >> 6) & 7;
      const off = (op & 0x3f) * 2;
      this.regs[reg] = (this.regs[reg] - 1) & 0xffff;
      if (this.regs[reg] !== 0) {
        this.regs[7] = (this.regs[7] - off) & 0xffff;
      }
      return true;
    }

    const hi = (op >> 8) & 0xff;
    if ((hi >= 0x01 && hi <= 0x07) || (hi >= 0x80 && hi <= 0x87)) {
      if (this.branchCond(hi)) {
        const rawDisp = op & 0xff;
        const signedDisp = (rawDisp & 0x80) !== 0 ? rawDisp - 256 : rawDisp;
        this.regs[7] = (this.regs[7] + signedDisp * 2) & 0xffff;
      }
      return true;
    }

    const top10 = (op >> 6) & 0x03ff;
    const singleByte = (op & 0x8000) !== 0;
    const sub = top10 & 0x01ff;
    if (sub >= 0x0028 && sub <= 0x0033) {
      const dst = this.resolveOperand(op & 0x3f, singleByte);
      const mask = singleByte ? 0x00ff : 0xffff;
      const msb = singleByte ? 0x0080 : 0x8000;
      const oldV = sub === 0x0028 ? 0 : this.readOperand(dst, singleByte);
      let res = 0;
      switch (sub) {
        case 0x0028:
          this.writeOperand(dst, 0, singleByte, false);
          this.setNz(0, singleByte, false, false, false);
          return true;
        case 0x0029:
          res = (~oldV) & mask;
          this.writeOperand(dst, res, singleByte, false);
          this.setNz(res, singleByte, false, true, false);
          return true;
        case 0x002a:
          res = (oldV + 1) & mask;
          this.writeOperand(dst, res, singleByte, false);
          this.setNz(res, singleByte, true, false, res === msb);
          return true;
        case 0x002b:
          res = (oldV - 1) & mask;
          this.writeOperand(dst, res, singleByte, false);
          this.setNz(res, singleByte, true, false, oldV === msb);
          return true;
        case 0x002c:
          res = (0 - oldV) & mask;
          this.writeOperand(dst, res, singleByte, false);
          this.setNz(res, singleByte, false, res !== 0, res === msb);
          return true;
        case 0x002f:
          this.setNz(oldV, singleByte, false, false, false);
          return true;
        case 0x0032: {
          const cout = (oldV & 1) !== 0;
          res = ((oldV >> 1) | (oldV & msb)) & mask;
          this.writeOperand(dst, res, singleByte, false);
          this.setNz(res, singleByte, false, cout, ((res & msb) !== 0) !== cout);
          return true;
        }
        case 0x0033: {
          const cout = (oldV & msb) !== 0;
          res = (oldV << 1) & mask;
          this.writeOperand(dst, res, singleByte, false);
          this.setNz(res, singleByte, false, cout, ((res & msb) !== 0) !== cout);
          return true;
        }
      }
    }

    const group = (op >> 12) & 0x0f;
    const baseOp = group & 0x07;
    let isByte = group >= 9 && group <= 13;
    if (baseOp >= 1 && baseOp <= 6) {
      if (group === 6 || group === 14) isByte = false;
      const srcOp = this.resolveOperand((op >> 6) & 0x3f, isByte);
      const dstOp = this.resolveOperand(op & 0x3f, isByte);
      const src = this.readOperand(srcOp, isByte);
      const mask = isByte ? 0x00ff : 0xffff;
      const msb = isByte ? 0x0080 : 0x8000;

      if (baseOp === 1) {
        this.writeOperand(dstOp, src, isByte, true);
        this.setNz(src, isByte, true, false, false);
        return true;
      }
      const dst = this.readOperand(dstOp, isByte);
      if (baseOp === 2) {
        const res = (src - dst) & mask;
        const v = (((src ^ dst) & (src ^ res)) & msb) !== 0;
        this.setNz(res, isByte, false, src < dst, v);
        return true;
      }
      if (baseOp === 3) {
        this.setNz(src & dst & mask, isByte, true, false, false);
        return true;
      }
      if (baseOp === 4) {
        const res = dst & ~src & mask;
        this.writeOperand(dstOp, res, isByte, false);
        this.setNz(res, isByte, true, false, false);
        return true;
      }
      if (baseOp === 5) {
        const res = (dst | src) & mask;
        this.writeOperand(dstOp, res, isByte, false);
        this.setNz(res, isByte, true, false, false);
        return true;
      }
      if (group === 6) {
        const sum = dst + src;
        const res = sum & 0xffff;
        const v = ((~(src ^ dst) & (src ^ res)) & 0x8000) !== 0;
        this.writeOperand(dstOp, res, false, false);
        this.setNz(res, false, false, sum > 0xffff, v);
        return true;
      }
      if (group === 14) {
        const diff = dst - src;
        const res = diff & 0xffff;
        const v = (((dst ^ src) & (dst ^ res)) & 0x8000) !== 0;
        this.writeOperand(dstOp, res, false, false);
        this.setNz(res, false, false, dst < src, v);
        return true;
      }
    }

    this.lastFault = op;
    this.halted = true;
    return false;
  }

  run(maxSteps = 500): number {
    let executed = 0;
    while (executed < maxSteps && !this.halted) {
      const prev = this.cycleCount;
      this.step();
      if (this.cycleCount > prev) executed++;
    }
    return executed;
  }

  getStateSnapshot(): Pdp11StateSnapshot {
    return {
      regs: Array.from(this.regs),
      octalRegs: {
        R0: octal16(this.regs[0]),
        R1: octal16(this.regs[1]),
        R2: octal16(this.regs[2]),
        R3: octal16(this.regs[3]),
        R4: octal16(this.regs[4]),
        R5: octal16(this.regs[5]),
        SP: octal16(this.regs[6]),
        PC: octal16(this.regs[7]),
        PSW: octal16(this.psw),
        SWITCH: octal16(this.switchReg),
        DISPLAY: octal16(this.displayReg),
      },
      psw: this.psw,
      flags: {
        N: (this.psw & PDP11_PSW_N) !== 0,
        Z: (this.psw & PDP11_PSW_Z) !== 0,
        V: (this.psw & PDP11_PSW_V) !== 0,
        C: (this.psw & PDP11_PSW_C) !== 0,
      },
      halted: this.halted,
      lastFault: this.lastFault,
      cycleCount: this.cycleCount,
      switchReg: this.switchReg,
      displayReg: this.displayReg,
      txText: this.txText,
      mmioTmRegs: Array.from(this.mmioTmRegs),
    };
  }
}

const DOUBLE_OPCODES: Record<string, number> = {
  MOV: 0o010000, MOVB: 0o110000, CMP: 0o020000, CMPB: 0o120000,
  BIT: 0o030000, BITB: 0o130000, BIC: 0o040000, BICB: 0o140000,
  BIS: 0o050000, BISB: 0o150000, ADD: 0o060000, SUB: 0o160000,
};

const SINGLE_OPCODES: Record<string, number> = {
  JMP: 0o000100, SWAB: 0o000300, CLR: 0o005000, CLRB: 0o105000,
  COM: 0o005100, COMB: 0o105100, INC: 0o005200, INCB: 0o105200,
  DEC: 0o005300, DECB: 0o105300, NEG: 0o005400, NEGB: 0o105400,
  TST: 0o005700, TSTB: 0o105700, ASR: 0o006200, ASRB: 0o106200,
  ASL: 0o006300, ASLB: 0o106300,
};

const BRANCH_OPCODES: Record<string, number> = {
  BR: 0o000400, BNE: 0o001000, BEQ: 0o001400, BGE: 0o002000,
  BLT: 0o002400, BGT: 0o003000, BLE: 0o003400, BPL: 0o100000,
  BMI: 0o100400, BHI: 0o101000, BLOS: 0o101400, BVC: 0o102000,
  BVS: 0o102400, BCC: 0o103000, BHIS: 0o103000, BCS: 0o103400, BLO: 0o103400,
};

function parseNumberLiteral(raw: string, labels: Record<string, number>, allowUnknown = false): number {
  const s = raw.trim();
  if (s in labels) return labels[s];
  if (s.startsWith("'") && s.length >= 2) return s.charCodeAt(1) & 0xff;
  if (/^0x[0-9a-f]+$/i.test(s)) return Number.parseInt(s.slice(2), 16) & 0xffff;
  if (/^[0-9]+\.$/.test(s)) return Number.parseInt(s.slice(0, -1), 10) & 0xffff;
  if (/^[0-7]+$/.test(s)) return Number.parseInt(s, 8) & 0xffff;
  if (allowUnknown && /^[A-Za-z_.$][A-Za-z0-9_.$]*$/.test(s)) return 0;
  throw new SyntaxError(`Invalid PDP-11 literal or label: "${raw}"`);
}

function parseReg(raw: string): number {
  const up = raw.trim().toUpperCase();
  if (up === 'SP') return 6;
  if (up === 'PC') return 7;
  const m = /^R([0-7])$/.exec(up);
  if (!m) throw new SyntaxError(`Invalid PDP-11 register: "${raw}"`);
  return Number(m[1]);
}

function encodeOperand(
  raw: string,
  currentPcAfterOp: number,
  labels: Record<string, number>,
  allowUnknown = false,
): { code: number; extra?: number } {
  const op = raw.trim();
  const up = op.toUpperCase();
  if (/^(R[0-7]|SP|PC)$/.test(up)) return { code: parseReg(up) };
  if (op.startsWith('#')) return { code: 0o27, extra: parseNumberLiteral(op.slice(1), labels, allowUnknown) };
  if (op.startsWith('@#')) return { code: 0o37, extra: parseNumberLiteral(op.slice(2), labels, allowUnknown) };
  let m = /^@\((R[0-7]|SP|PC)\)\+$/i.exec(op);
  if (m) return { code: 0o30 | parseReg(m[1]) };
  m = /^\((R[0-7]|SP|PC)\)\+$/i.exec(op);
  if (m) return { code: 0o20 | parseReg(m[1]) };
  m = /^@-\((R[0-7]|SP|PC)\)$/i.exec(op);
  if (m) return { code: 0o50 | parseReg(m[1]) };
  m = /^-\((R[0-7]|SP|PC)\)$/i.exec(op);
  if (m) return { code: 0o40 | parseReg(m[1]) };
  m = /^\((R[0-7]|SP|PC)\)$/i.exec(op);
  if (m) return { code: 0o10 | parseReg(m[1]) };
  m = /^@(.+)\((R[0-7]|SP|PC)\)$/i.exec(op);
  if (m) return { code: 0o70 | parseReg(m[2]), extra: parseNumberLiteral(m[1], labels, allowUnknown) };
  m = /^(.+)\((R[0-7]|SP|PC)\)$/i.exec(op);
  if (m) return { code: 0o60 | parseReg(m[2]), extra: parseNumberLiteral(m[1], labels, allowUnknown) };
  const target = parseNumberLiteral(op, labels, allowUnknown);
  return { code: 0o67, extra: (target - (currentPcAfterOp + 2)) & 0xffff };
}

function splitArgs(rest: string): string[] {
  const args: string[] = [];
  let cur = '';
  let inQuote = false;
  for (let i = 0; i < rest.length; i++) {
    const ch = rest[i];
    if (ch === "'" || ch === '"') inQuote = !inQuote;
    if (ch === ',' && !inQuote) {
      args.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  if (cur.trim().length > 0) args.push(cur.trim());
  return args;
}

function stripComment(line: string): string {
  let inQuote = false;
  let qChar = '';
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (!inQuote && (ch === '"' || ch === "'")) {
      inQuote = true;
      qChar = ch;
    } else if (inQuote && ch === qChar) {
      inQuote = false;
    } else if (!inQuote && ch === ';') {
      return line.slice(0, i);
    }
  }
  return line;
}

function decodeAscizBytes(arg: string): number[] {
  const trimmed = arg.trim();
  const str = trimmed.startsWith('"') && trimmed.endsWith('"') ? trimmed.slice(1, -1) : trimmed;
  const bytes: number[] = [];
  for (let i = 0; i < str.length; i++) {
    if (str[i] === '\\' && i + 1 < str.length) {
      const next = str[++i];
      if (next === 'r') bytes.push(13);
      else if (next === 'n') bytes.push(10);
      else if (next === 't') bytes.push(9);
      else if (next === '0') bytes.push(0);
      else bytes.push(next.charCodeAt(0) & 0xff);
    } else {
      bytes.push(str.charCodeAt(i) & 0xff);
    }
  }
  bytes.push(0);
  if ((bytes.length & 1) !== 0) bytes.push(0);
  return bytes;
}

export function assemblePdp11(lines: readonly string[], origin = 0o001000): AssembledProgram {
  const cleaned = lines.map((l) => stripComment(l).trim()).filter((s) => s.length > 0);
  const labels: Record<string, number> = {};
  const zeroLabels: Record<string, number> = {};

  let pc = origin & 0xffff;
  for (const line of cleaned) {
    let stmt = line;
    const lblMatch = /^([A-Za-z_.$][A-Za-z0-9_.$]*):\s*(.*)$/.exec(stmt);
    if (lblMatch) {
      labels[lblMatch[1]] = pc;
      zeroLabels[lblMatch[1]] = 0;
      stmt = lblMatch[2].trim();
      if (stmt.length === 0) continue;
    }
    const spIdx = stmt.search(/\s/);
    const op = (spIdx === -1 ? stmt : stmt.slice(0, spIdx)).toUpperCase();
    const rest = spIdx === -1 ? '' : stmt.slice(spIdx + 1).trim();

    if (op === '.WORD') { pc = (pc + splitArgs(rest).length * 2) & 0xffff; continue; }
    if (op === '.ASCIZ') { pc = (pc + decodeAscizBytes(rest).length) & 0xffff; continue; }
    if (op === 'HALT' || op === 'WAIT' || op === 'RESET' || op === 'RTS' || op === 'SOB' || op in BRANCH_OPCODES) {
      pc = (pc + 2) & 0xffff;
      continue;
    }
    if (op === 'JSR') {
      const args = splitArgs(rest);
      const dst = encodeOperand(args[1], pc + 2, zeroLabels, true);
      pc = (pc + 2 + (dst.extra !== undefined ? 2 : 0)) & 0xffff;
      continue;
    }
    if (op in SINGLE_OPCODES) {
      const dst = encodeOperand(rest, pc + 2, zeroLabels, true);
      pc = (pc + 2 + (dst.extra !== undefined ? 2 : 0)) & 0xffff;
      continue;
    }
    if (op in DOUBLE_OPCODES) {
      const args = splitArgs(rest);
      const src = encodeOperand(args[0], pc + 2, zeroLabels, true);
      const afterSrc = (pc + 2 + (src.extra !== undefined ? 2 : 0)) & 0xffff;
      const dst = encodeOperand(args[1], afterSrc, zeroLabels, true);
      pc = (afterSrc + (dst.extra !== undefined ? 2 : 0)) & 0xffff;
      continue;
    }
    throw new SyntaxError(`Unsupported PDP-11 mnemonic: "${op}"`);
  }

  const words: number[] = [];
  pc = origin & 0xffff;
  for (const line of cleaned) {
    let stmt = line;
    const lblMatch = /^([A-Za-z_.$][A-Za-z0-9_.$]*):\s*(.*)$/.exec(stmt);
    if (lblMatch) {
      stmt = lblMatch[2].trim();
      if (stmt.length === 0) continue;
    }
    const spIdx = stmt.search(/\s/);
    const op = (spIdx === -1 ? stmt : stmt.slice(0, spIdx)).toUpperCase();
    const rest = spIdx === -1 ? '' : stmt.slice(spIdx + 1).trim();

    if (op === '.WORD') {
      for (const arg of splitArgs(rest)) { words.push(parseNumberLiteral(arg, labels)); pc = (pc + 2) & 0xffff; }
    } else if (op === '.ASCIZ') {
      const bytes = decodeAscizBytes(rest);
      for (let i = 0; i < bytes.length; i += 2) { words.push(bytes[i] | (bytes[i + 1] << 8)); pc = (pc + 2) & 0xffff; }
    } else if (op === 'HALT') { words.push(0o000000); pc = (pc + 2) & 0xffff;
    } else if (op === 'WAIT') { words.push(0o000001); pc = (pc + 2) & 0xffff;
    } else if (op === 'RESET') { words.push(0o000005); pc = (pc + 2) & 0xffff;
    } else if (op === 'RTS') { words.push(0o000200 | parseReg(rest)); pc = (pc + 2) & 0xffff;
    } else if (op === 'SOB') {
      const args = splitArgs(rest);
      const off = (((pc + 2) - parseNumberLiteral(args[1], labels)) >> 1) & 0x3f;
      words.push(0o077000 | (parseReg(args[0]) << 6) | off);
      pc = (pc + 2) & 0xffff;
    } else if (op in BRANCH_OPCODES) {
      const wordOffset = ((parseNumberLiteral(rest, labels) - (pc + 2)) >> 1) & 0xff;
      words.push(BRANCH_OPCODES[op] | wordOffset);
      pc = (pc + 2) & 0xffff;
    } else if (op === 'JSR') {
      const args = splitArgs(rest);
      const dst = encodeOperand(args[1], pc + 2, labels);
      words.push(0o004000 | (parseReg(args[0]) << 6) | dst.code);
      pc = (pc + 2) & 0xffff;
      if (dst.extra !== undefined) { words.push(dst.extra & 0xffff); pc = (pc + 2) & 0xffff; }
    } else if (op in SINGLE_OPCODES) {
      const dst = encodeOperand(rest, pc + 2, labels);
      words.push(SINGLE_OPCODES[op] | dst.code);
      pc = (pc + 2) & 0xffff;
      if (dst.extra !== undefined) { words.push(dst.extra & 0xffff); pc = (pc + 2) & 0xffff; }
    } else if (op in DOUBLE_OPCODES) {
      const args = splitArgs(rest);
      const src = encodeOperand(args[0], pc + 2, labels);
      const afterSrc = (pc + 2 + (src.extra !== undefined ? 2 : 0)) & 0xffff;
      const dst = encodeOperand(args[1], afterSrc, labels);
      words.push(DOUBLE_OPCODES[op] | (src.code << 6) | dst.code);
      pc = (pc + 2) & 0xffff;
      if (src.extra !== undefined) { words.push(src.extra & 0xffff); pc = (pc + 2) & 0xffff; }
      if (dst.extra !== undefined) { words.push(dst.extra & 0xffff); pc = (pc + 2) & 0xffff; }
    }
  }
  return { origin: origin & 0xffff, words, labels };
}

export function assembleTelemetryMonitorProgram(origin = 0o001000): AssembledProgram {
  return assemblePdp11([
    'START:',
    '  MOV #S_HDR, R5',
    '  JSR PC, PUTS',
    '  MOV @#177010, R0',
    '  JSR PC, PR3',
    '  MOV #S_CPU, R5',
    '  JSR PC, PUTS',
    '  MOV @#177000, R0',
    '  JSR PC, PRDEC1',
    '  MOV #S_MEM, R5',
    '  JSR PC, PUTS',
    '  MOV @#177002, R0',
    '  JSR PC, PRDEC1',
    '  MOV #S_PROC, R5',
    '  JSR PC, PUTS',
    '  MOV @#177004, R0',
    '  JSR PC, PR3',
    '  MOVB #15, @#177566',
    '  MOVB #12, @#177566',
    '  MOV @#177000, R0',
    '  MOV @#177002, R1',
    '  MOV @#177004, R2',
    '  MOV @#177006, R3',
    '  MOV @#177010, R4',
    '  MOV R0, R5',
    '  ADD R1, R5',
    '  MOV R0, @#177570',
    '  HALT',
    'PUTS:',
    '  MOVB (R5)+, R1',
    '  BEQ PUTS_DONE',
    '  MOVB R1, @#177566',
    '  BR PUTS',
    'PUTS_DONE:',
    '  RTS PC',
    'PR3:',
    '  JSR PC, DIV100',
    '  ADD #60, R0',
    '  MOVB R0, @#177566',
    '  RTS PC',
    'PRDEC1:',
    '  JSR PC, DIV100',
    '  MOVB #56, @#177566',
    '  ADD #60, R0',
    '  MOVB R0, @#177566',
    '  MOVB #45, @#177566',
    '  RTS PC',
    'DIV100:',
    '  MOV #60, R1',
    '  CMP R0, #764',
    '  BLT D100_2A',
    '  SUB #764, R0',
    '  ADD #5, R1',
    'D100_2A:',
    '  CMP R0, #310',
    '  BLT D100_2B',
    '  SUB #310, R0',
    '  ADD #2, R1',
    'D100_2B:',
    '  CMP R0, #310',
    '  BLT D100_1',
    '  SUB #310, R0',
    '  ADD #2, R1',
    'D100_1:',
    '  CMP R0, #144',
    '  BLT D100_OUT',
    '  SUB #144, R0',
    '  INC R1',
    'D100_OUT:',
    '  MOVB R1, @#177566',
    'DIV10:',
    '  MOV #60, R1',
    '  CMP R0, #62',
    '  BLT D10_2A',
    '  SUB #62, R0',
    '  ADD #5, R1',
    'D10_2A:',
    '  CMP R0, #24',
    '  BLT D10_2B',
    '  SUB #24, R0',
    '  ADD #2, R1',
    'D10_2B:',
    '  CMP R0, #24',
    '  BLT D10_1',
    '  SUB #24, R0',
    '  ADD #2, R1',
    'D10_1:',
    '  CMP R0, #12',
    '  BLT D10_OUT',
    '  SUB #12, R0',
    '  INC R1',
    'D10_OUT:',
    '  MOVB R1, @#177566',
    '  RTS PC',
    'S_HDR:  .ASCIZ "PDP11 SEQ="',
    'S_CPU:  .ASCIZ " CPU="',
    'S_MEM:  .ASCIZ " MEM="',
    'S_PROC: .ASCIZ " PROC="',
  ], origin);
}

export function runPdp11Demo(cpuPct = 34.5, memPct = 61.2, procCount = 48, seq = 1): Pdp11StateSnapshot {
  const vm = new Pdp11Machine(0o001000);
  vm.switchReg = 0o125252;
  vm.loadProgram(assembleTelemetryMonitorProgram(0o001000));
  vm.injectTelemetry(Math.round(cpuPct * 10), Math.round(memPct * 10), procCount, 420, seq);
  vm.run(300);
  return vm.getStateSnapshot();
}

if (import.meta.main) {
  const snap = runPdp11Demo();
  console.log(JSON.stringify({
    schema: 'b8g-pdp11-demo.v1',
    abiMagic: `0x${B8G_PDP11_ABI_MAGIC.toString(16).toUpperCase()}`,
    v3Magic: `0x${B8G_ABI_MAGIC_V3.toString(16).toUpperCase()}`,
    halted: snap.halted,
    cycleCount: snap.cycleCount,
    kl11Output: snap.txText.trim(),
    octalRegs: snap.octalRegs,
  }, null, 2));
}
