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
export const B8G_PDP11_MMR0 = 0o177572;
export const B8G_PDP11_KPDR_BASE = 0o172300;
export const B8G_PDP11_KPAR_BASE = 0o172340;

export const PDP11_DISK_BLOCK_BYTES = 512;
export const PDP11_DISK_WORDS_PER_BLOCK = 256;
export const PDP11_DISK_BLOCK_COUNT = 32;
export const PDP11_UNIX_V6_SUPERBLOCK_MAGIC = 0o060606;
export const PDP11_RSX11M_SUPERBLOCK_MAGIC = 0o110011;
export const PDP11_BARE_METAL_SUPERBLOCK_MAGIC = 0o031520;

export type DiskPresetId = 'bare-metal' | 'v6-rk05' | 'rsx11m-rx01';

export interface Pdp11BusCycleEntry {
  readonly cycle: number;
  readonly pcOctal: string;
  readonly physOctal: string;
  readonly opcodeOctal: string;
  readonly busOp: 'FETCH' | 'MMIO_RD' | 'MMIO_WR' | 'HALT';
  readonly targetOctal: string;
  readonly valueOctal: string;
}

export interface Pdp11MmuSnapshot {
  readonly enabled: boolean;
  readonly mmr0Octal: string;
  readonly kpar: readonly string[];
  readonly kpdr: readonly string[];
}

export interface Pdp11DiskInode {
  readonly ino: number;
  readonly path: string;
  readonly kind: 'dir' | 'file' | 'task' | 'dev';
  readonly mode: number;
  readonly modeOctal: string;
  readonly nlink: number;
  readonly uid: number;
  readonly gid: number;
  readonly sizeBytes: number;
  readonly blocks: readonly number[];
  readonly description: string;
}

export interface Pdp11DirEntry {
  readonly ino: number;
  readonly name: string;
  readonly path: string;
}

export interface Pdp11SuperblockInfo {
  readonly presetId: DiskPresetId;
  readonly label: string;
  readonly drive: string;
  readonly magic: number;
  readonly magicOctal: string;
  readonly blockSize: number;
  readonly inodeBlocks: number;
  readonly volumeTotalBlocks: number;
  readonly freeCount: number;
  readonly freeBlocks: readonly number[];
  readonly freeInodeCount: number;
  readonly freeInodes: readonly number[];
}

export interface Pdp11DiskImage {
  readonly presetId: DiskPresetId;
  readonly label: string;
  readonly drive: string;
  readonly blockBytes: number;
  readonly blockCount: number;
  readonly bytes: Uint8Array;
  readonly superblock: Pdp11SuperblockInfo;
  readonly inodes: readonly Pdp11DiskInode[];
  readonly rootEntries: readonly Pdp11DirEntry[];
  readonly bootBanner: string;
}

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
  readonly mmu: Pdp11MmuSnapshot;
  readonly busTrace: readonly Pdp11BusCycleEntry[];
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

export function octal18(value: number): string {
  return ((value & 0x3ffff) >>> 0).toString(8).padStart(6, '0');
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
  readonly kpar = new Uint16Array(8);
  readonly kpdr = new Uint16Array(8);
  readonly busTrace: Pdp11BusCycleEntry[] = [];

  psw = 0;
  mmr0 = 0;
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
    for (let i = 0; i < 7; i++) {
      this.kpar[i] = (i * 0o200) & 0o7777;
      this.kpdr[i] = 0o077406;
    }
    this.kpar[7] = 0o007600;
    this.kpdr[7] = 0o077406;
    this.busTrace.length = 0;
    this.mmr0 = 0;
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

  translatePhysical18(vaddr: number): number {
    const va = vaddr & 0xffff;
    if ((this.mmr0 & 1) === 0) {
      return va >= 0o160000 ? (0o760000 | (va & 0o017777)) : va;
    }
    const apr = (va >> 13) & 7;
    const par = this.kpar[apr] & 0o7777;
    return (((par << 6) + (va & 0o017777)) & 0x3ffff);
  }

  private recordBusCycle(
    pcBefore: number,
    opcode: number,
    busOp: Pdp11BusCycleEntry['busOp'],
    target: number,
    value: number,
  ): void {
    if (this.busTrace.length >= 64) {
      this.busTrace.shift();
    }
    this.busTrace.push({
      cycle: this.cycleCount,
      pcOctal: octal16(pcBefore),
      physOctal: octal18(this.translatePhysical18(pcBefore)),
      opcodeOctal: octal16(opcode),
      busOp,
      targetOctal: octal16(target),
      valueOctal: octal16(value),
    });
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
    if (even >= B8G_PDP11_KPDR_BASE && even < B8G_PDP11_KPDR_BASE + 16) {
      return this.kpdr[(even - B8G_PDP11_KPDR_BASE) >> 1];
    }
    if (even >= B8G_PDP11_KPAR_BASE && even < B8G_PDP11_KPAR_BASE + 16) {
      return this.kpar[(even - B8G_PDP11_KPAR_BASE) >> 1];
    }
    if (even === B8G_PDP11_KL11_XCSR) return 0x0080;
    if (even === B8G_PDP11_KL11_XBUF) return 0x0000;
    if (even === B8G_PDP11_SWITCH_REG) return this.switchReg;
    if (even === B8G_PDP11_MMR0) return this.mmr0;
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
    if (even === B8G_PDP11_MMR0) {
      this.mmr0 = v;
      this.writeRam16(even, v);
      return;
    }
    if (even >= B8G_PDP11_KPDR_BASE && even < B8G_PDP11_KPDR_BASE + 16) {
      this.kpdr[(even - B8G_PDP11_KPDR_BASE) >> 1] = v;
      this.writeRam16(even, v);
      return;
    }
    if (even >= B8G_PDP11_KPAR_BASE && even < B8G_PDP11_KPAR_BASE + 16) {
      this.kpar[(even - B8G_PDP11_KPAR_BASE) >> 1] = v & 0o7777;
      this.writeRam16(even, v & 0o7777);
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
    const pcBefore = this.regs[7];
    const op = this.fetchWord();
    this.cycleCount++;

    if (op === 0o000000) {
      this.recordBusCycle(pcBefore, op, 'HALT', pcBefore, op);
      this.halted = true;
      return false;
    }
    this.recordBusCycle(pcBefore, op, 'FETCH', pcBefore, op);
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
      mmu: {
        enabled: (this.mmr0 & 1) !== 0,
        mmr0Octal: octal16(this.mmr0),
        kpar: Array.from(this.kpar, (w) => octal16(w)),
        kpdr: Array.from(this.kpdr, (w) => octal16(w)),
      },
      busTrace: [...this.busTrace],
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

function writeWord16(buf: Uint8Array, byteOffset: number, value: number): void {
  const v = value & 0xffff;
  buf[byteOffset] = v & 0xff;
  buf[byteOffset + 1] = (v >> 8) & 0xff;
}

function readWord16(buf: Uint8Array, byteOffset: number): number {
  return (buf[byteOffset] | (buf[byteOffset + 1] << 8)) & 0xffff;
}

function writeAsciiFixed(buf: Uint8Array, byteOffset: number, maxLen: number, text: string): void {
  buf.fill(0, byteOffset, byteOffset + maxLen);
  const n = Math.min(maxLen, text.length);
  for (let i = 0; i < n; i++) {
    buf[byteOffset + i] = text.charCodeAt(i) & 0xff;
  }
}

function readAsciiFixed(buf: Uint8Array, byteOffset: number, maxLen: number): string {
  let out = '';
  for (let i = 0; i < maxLen; i++) {
    const ch = buf[byteOffset + i];
    if (ch === 0) break;
    out += String.fromCharCode(ch);
  }
  return out;
}

interface DiskPresetLayout {
  readonly presetId: DiskPresetId;
  readonly label: string;
  readonly drive: string;
  readonly magic: number;
  readonly volumeTotalBlocks: number;
  readonly inodeBlocks: number;
  readonly freeBlocks: readonly number[];
  readonly freeInodes: readonly number[];
  readonly bootBanner: string;
  readonly inodes: readonly Pdp11DiskInode[];
  readonly dirBlocks: readonly {
    readonly blockNum: number;
    readonly prefixPath: string;
    readonly entries: readonly { readonly ino: number; readonly name: string }[];
  }[];
  readonly payloads: readonly { readonly blockNum: number; readonly text: string }[];
}

function buildDiskImageFromLayout(layout: DiskPresetLayout): Pdp11DiskImage {
  const bytes = new Uint8Array(PDP11_DISK_BLOCK_COUNT * PDP11_DISK_BLOCK_BYTES);

  // Block 0: Clean-room PDP-11 Boot Block
  const bootStubWords = [0o012706, 0o000700, 0o012705, 0o001040, 0o000000];
  for (let i = 0; i < bootStubWords.length; i++) {
    writeWord16(bytes, i * 2, bootStubWords[i]);
  }
  writeAsciiFixed(bytes, 32, 96, layout.bootBanner);

  // Block 1: Unix V6 filsys / ODS-1 Superblock (512 bytes)
  const sbOff = PDP11_DISK_BLOCK_BYTES;
  writeWord16(bytes, sbOff + 0, layout.inodeBlocks);
  writeWord16(bytes, sbOff + 2, layout.volumeTotalBlocks);
  writeWord16(bytes, sbOff + 4, layout.freeBlocks.length);
  for (let i = 0; i < Math.min(100, layout.freeBlocks.length); i++) {
    writeWord16(bytes, sbOff + 6 + i * 2, layout.freeBlocks[i]);
  }
  writeWord16(bytes, sbOff + 206, layout.freeInodes.length);
  for (let i = 0; i < Math.min(100, layout.freeInodes.length); i++) {
    writeWord16(bytes, sbOff + 208 + i * 2, layout.freeInodes[i]);
  }
  writeWord16(bytes, sbOff + 224, 0);
  writeWord16(bytes, sbOff + 226, 0x6995);
  writeWord16(bytes, sbOff + 228, 0x2026);
  writeWord16(bytes, sbOff + 230, layout.magic);
  writeAsciiFixed(bytes, sbOff + 240, 16, layout.label);
  writeAsciiFixed(bytes, sbOff + 256, 16, layout.drive);

  // Block 2: Inode Table (16 x 32-byte inodes, 1-indexed)
  const inoBlockOff = 2 * PDP11_DISK_BLOCK_BYTES;
  for (const inode of layout.inodes) {
    if (inode.ino < 1 || inode.ino > 16) continue;
    const off = inoBlockOff + (inode.ino - 1) * 32;
    writeWord16(bytes, off + 0, inode.mode);
    bytes[off + 2] = inode.nlink & 0xff;
    bytes[off + 3] = inode.uid & 0xff;
    bytes[off + 4] = inode.gid & 0xff;
    bytes[off + 5] = (inode.sizeBytes >> 16) & 0xff;
    writeWord16(bytes, off + 6, inode.sizeBytes & 0xffff);
    for (let b = 0; b < Math.min(8, inode.blocks.length); b++) {
      writeWord16(bytes, off + 8 + b * 2, inode.blocks[b]);
    }
    writeWord16(bytes, off + 24, 0x2026);
    writeWord16(bytes, off + 28, 0x2026);
  }

  // Directory Blocks (16 bytes per entry: 2B ino + 14B NUL-padded name)
  const rootEntries: Pdp11DirEntry[] = [];
  for (const dir of layout.dirBlocks) {
    const dirOff = dir.blockNum * PDP11_DISK_BLOCK_BYTES;
    dir.entries.forEach((entry, idx) => {
      const eOff = dirOff + idx * 16;
      if (eOff + 16 > (dir.blockNum + 1) * PDP11_DISK_BLOCK_BYTES) return;
      writeWord16(bytes, eOff, entry.ino);
      writeAsciiFixed(bytes, eOff + 2, 14, entry.name);
      const prefix = dir.prefixPath.endsWith('/') ? dir.prefixPath : `${dir.prefixPath}/`;
      rootEntries.push({
        ino: entry.ino,
        name: entry.name,
        path: entry.name === '.' || entry.name === '..' ? `${prefix}${entry.name}` : `${prefix}${entry.name}`,
      });
    });
  }

  // Payload Blocks (clean-room executable/script/boot metadata)
  for (const payload of layout.payloads) {
    const pOff = payload.blockNum * PDP11_DISK_BLOCK_BYTES;
    writeAsciiFixed(bytes, pOff, PDP11_DISK_BLOCK_BYTES, payload.text);
  }

  const sbBlock = bytes.slice(PDP11_DISK_BLOCK_BYTES, 2 * PDP11_DISK_BLOCK_BYTES);
  const parsedSb = parseSuperblockFromBlock(sbBlock, layout.presetId);

  return {
    presetId: layout.presetId,
    label: layout.label,
    drive: layout.drive,
    blockBytes: PDP11_DISK_BLOCK_BYTES,
    blockCount: PDP11_DISK_BLOCK_COUNT,
    bytes,
    superblock: {
      presetId: layout.presetId,
      label: parsedSb.label,
      drive: layout.drive,
      magic: parsedSb.magic,
      magicOctal: parsedSb.magicOctal,
      blockSize: PDP11_DISK_BLOCK_BYTES,
      inodeBlocks: parsedSb.inodeBlocks,
      volumeTotalBlocks: parsedSb.volumeTotalBlocks,
      freeCount: parsedSb.freeCount,
      freeBlocks: parsedSb.freeBlocks,
      freeInodeCount: parsedSb.freeInodeCount,
      freeInodes: layout.freeInodes,
    },
    inodes: layout.inodes,
    rootEntries,
    bootBanner: layout.bootBanner,
  };
}

export function buildUnixV6DiskImage(): Pdp11DiskImage {
  return buildDiskImageFromLayout({
    presetId: 'v6-rk05',
    label: 'UNIX-V6-RK05',
    drive: 'RK05',
    magic: PDP11_UNIX_V6_SUPERBLOCK_MAGIC,
    volumeTotalBlocks: 4872,
    inodeBlocks: 16,
    freeBlocks: [25, 26, 27, 28, 29, 30, 31],
    freeInodes: [9, 10, 11, 12, 13, 14, 15, 16],
    bootBanner: 'UNIX V6 RK05 BOOT: /etc/init -> /bin/sh',
    inodes: [
      { ino: 1, path: '/', kind: 'dir', mode: 0o140755, modeOctal: '140755', nlink: 4, uid: 0, gid: 0, sizeBytes: 96, blocks: [18], description: 'Root directory (/)' },
      { ino: 2, path: '/etc', kind: 'dir', mode: 0o140755, modeOctal: '140755', nlink: 2, uid: 0, gid: 0, sizeBytes: 48, blocks: [19], description: 'System configuration & init directory' },
      { ino: 3, path: '/etc/init', kind: 'file', mode: 0o100755, modeOctal: '100755', nlink: 1, uid: 0, gid: 0, sizeBytes: 192, blocks: [21], description: 'Clean-room PID 1 init launcher -> spawns /bin/sh' },
      { ino: 4, path: '/bin', kind: 'dir', mode: 0o140755, modeOctal: '140755', nlink: 2, uid: 0, gid: 0, sizeBytes: 64, blocks: [20], description: 'Essential user binaries' },
      { ino: 5, path: '/bin/sh', kind: 'file', mode: 0o100755, modeOctal: '100755', nlink: 1, uid: 0, gid: 0, sizeBytes: 256, blocks: [22], description: 'Clean-room V6 Thompson-style command shell' },
      { ino: 6, path: '/dev', kind: 'dir', mode: 0o140755, modeOctal: '140755', nlink: 2, uid: 0, gid: 0, sizeBytes: 32, blocks: [18], description: 'Device nodes' },
      { ino: 7, path: '/dev/kl11', kind: 'dev', mode: 0o120666, modeOctal: '120666', nlink: 1, uid: 0, gid: 0, sizeBytes: 0, blocks: [0o177564], description: 'KL11 serial console (CSR 0177564, BUF 0177566)' },
      { ino: 8, path: '/bin/taskmgr', kind: 'file', mode: 0o100755, modeOctal: '100755', nlink: 1, uid: 0, gid: 0, sizeBytes: 224, blocks: [23], description: 'B8G UNIBUS Task Manager telemetry binary (0177000..0177010)' },
    ],
    dirBlocks: [
      {
        blockNum: 18,
        prefixPath: '/',
        entries: [
          { ino: 1, name: '.' },
          { ino: 1, name: '..' },
          { ino: 2, name: 'etc' },
          { ino: 4, name: 'bin' },
          { ino: 6, name: 'dev' },
          { ino: 8, name: 'taskmgr' },
        ],
      },
      {
        blockNum: 19,
        prefixPath: '/etc',
        entries: [
          { ino: 2, name: '.' },
          { ino: 1, name: '..' },
          { ino: 3, name: 'init' },
        ],
      },
      {
        blockNum: 20,
        prefixPath: '/bin',
        entries: [
          { ino: 4, name: '.' },
          { ino: 1, name: '..' },
          { ino: 5, name: 'sh' },
          { ino: 8, name: 'taskmgr' },
        ],
      },
    ],
    payloads: [
      { blockNum: 21, text: '; B8G CLEAN-ROOM /etc/init\nMOUNT RK05 / READONLY\nEXEC /bin/sh -c "/bin/taskmgr"\n' },
      { blockNum: 22, text: '# /bin/sh clean-room script\nPATH=/bin:/etc\nexec /bin/taskmgr --mmio=0177000\n' },
      { blockNum: 23, text: 'B8G_TASKMGR_V6::MMIO=0177000..0177010 KL11=0177566\n' },
    ],
  });
}

export function buildRsx11mDiskImage(): Pdp11DiskImage {
  return buildDiskImageFromLayout({
    presetId: 'rsx11m-rx01',
    label: 'RSX11M-RX01',
    drive: 'RX01',
    magic: PDP11_RSX11M_SUPERBLOCK_MAGIC,
    volumeTotalBlocks: 494,
    inodeBlocks: 16,
    freeBlocks: [25, 26, 27, 28, 29, 30, 31],
    freeInodes: [7, 8, 9, 10, 11, 12, 13, 14],
    bootBanner: 'RSX-11M RX01: MCR> INS [1,54]TASKMGR.TSK',
    inodes: [
      { ino: 1, path: '[000000]000000.DIR;1', kind: 'dir', mode: 0o140755, modeOctal: '140755', nlink: 3, uid: 1, gid: 1, sizeBytes: 112, blocks: [18], description: 'ODS-1 Master File Directory (MFD)' },
      { ino: 2, path: '[000000]INDEXF.SYS;1', kind: 'file', mode: 0o100644, modeOctal: '100644', nlink: 1, uid: 1, gid: 1, sizeBytes: 512, blocks: [2], description: 'ODS-1 Index File Header Table' },
      { ino: 3, path: '[001054]MCR.TSK;1', kind: 'task', mode: 0o100755, modeOctal: '100755', nlink: 1, uid: 1, gid: 54, sizeBytes: 256, blocks: [21], description: 'Monitor Console Routine (MCR) command parser task' },
      { ino: 4, path: '[001054]TASKMGR.TSK;1', kind: 'task', mode: 0o100755, modeOctal: '100755', nlink: 1, uid: 1, gid: 54, sizeBytes: 320, blocks: [22], description: 'B8G Real-Time Executive Task Manager (.TSK)' },
      { ino: 5, path: '[001054]STARTUP.CMD;1', kind: 'file', mode: 0o100644, modeOctal: '100644', nlink: 1, uid: 1, gid: 54, sizeBytes: 128, blocks: [23], description: 'RSX-11M MCR Startup Script' },
      { ino: 6, path: '[001054]PIP.TSK;1', kind: 'task', mode: 0o100755, modeOctal: '100755', nlink: 1, uid: 1, gid: 54, sizeBytes: 192, blocks: [24], description: 'Peripheral Interchange Program (PIP) disk utility' },
    ],
    dirBlocks: [
      {
        blockNum: 18,
        prefixPath: '[001054]',
        entries: [
          { ino: 1, name: '.' },
          { ino: 1, name: '..' },
          { ino: 2, name: 'INDEXF.SYS;1' },
          { ino: 3, name: 'MCR.TSK;1' },
          { ino: 4, name: 'TASKMGR.TSK;1' },
          { ino: 5, name: 'STARTUP.CMD;1' },
          { ino: 6, name: 'PIP.TSK;1' },
        ],
      },
    ],
    payloads: [
      { blockNum: 21, text: '; B8G CLEAN-ROOM MCR.TSK\nMCR> ACT /TERM=TT0:\nMCR> RUN [1,54]TASKMGR.TSK\n' },
      { blockNum: 22, text: 'RSX11M_TASK_HDR [TASKMGR.TSK] PAR=0172340 MMIO=0177000\n' },
      { blockNum: 23, text: '; [1,54]STARTUP.CMD\nINS [1,54]TASKMGR.TSK\nRUN [1,54]TASKMGR.TSK\n' },
      { blockNum: 24, text: 'PIP DY0:[1,54]*.TSK/LI\n' },
    ],
  });
}

export function buildBareMetalDiskImage(): Pdp11DiskImage {
  return buildDiskImageFromLayout({
    presetId: 'bare-metal',
    label: 'B8G-TASKMGR',
    drive: 'MEMROM',
    magic: PDP11_BARE_METAL_SUPERBLOCK_MAGIC,
    volumeTotalBlocks: 32,
    inodeBlocks: 4,
    freeBlocks: [22, 23, 24, 25, 26, 27, 28, 29, 30, 31],
    freeInodes: [3, 4, 5, 6, 7, 8],
    bootBanner: 'B8G BARE-METAL ROM: ORIGIN 001000',
    inodes: [
      { ino: 1, path: '/', kind: 'dir', mode: 0o140755, modeOctal: '140755', nlink: 2, uid: 0, gid: 0, sizeBytes: 48, blocks: [18], description: 'Bare-metal ROM root' },
      { ino: 2, path: '/taskmgr.bin', kind: 'file', mode: 0o100755, modeOctal: '100755', nlink: 1, uid: 0, gid: 0, sizeBytes: 256, blocks: [21], description: 'Standalone UNIBUS Telemetry Monitor at 001000' },
    ],
    dirBlocks: [
      {
        blockNum: 18,
        prefixPath: '/',
        entries: [
          { ino: 1, name: '.' },
          { ino: 1, name: '..' },
          { ino: 2, name: 'taskmgr.bin' },
        ],
      },
    ],
    payloads: [
      { blockNum: 21, text: 'B8G PDP-11/40 BARE-METAL TELEMETRY MONITOR ORIGIN 001000\n' },
    ],
  });
}

export function getDiskPresetImage(presetId: DiskPresetId): Pdp11DiskImage {
  if (presetId === 'v6-rk05') return buildUnixV6DiskImage();
  if (presetId === 'rsx11m-rx01') return buildRsx11mDiskImage();
  return buildBareMetalDiskImage();
}

export function readDiskBlock(image: Pdp11DiskImage, blockNum: number): Uint8Array {
  if (!Number.isInteger(blockNum) || blockNum < 0 || blockNum >= image.blockCount) {
    throw new RangeError(`Disk block ${blockNum} out of range [0..${image.blockCount - 1}]`);
  }
  const start = blockNum * image.blockBytes;
  return image.bytes.slice(start, start + image.blockBytes);
}

export function parseSuperblockFromBlock(
  blockBytes: Uint8Array,
  presetHint: DiskPresetId = 'v6-rk05',
): {
  readonly presetId: DiskPresetId;
  readonly magic: number;
  readonly magicOctal: string;
  readonly inodeBlocks: number;
  readonly volumeTotalBlocks: number;
  readonly freeCount: number;
  readonly freeBlocks: readonly number[];
  readonly freeInodeCount: number;
  readonly label: string;
  readonly drive: string;
} {
  if (blockBytes.byteLength < PDP11_DISK_BLOCK_BYTES) {
    throw new RangeError('Superblock buffer must be at least 512 bytes');
  }
  const inodeBlocks = readWord16(blockBytes, 0);
  const volumeTotalBlocks = readWord16(blockBytes, 2);
  const freeCount = Math.min(100, readWord16(blockBytes, 4));
  const freeBlocks: number[] = [];
  for (let i = 0; i < freeCount; i++) {
    freeBlocks.push(readWord16(blockBytes, 6 + i * 2));
  }
  const freeInodeCount = Math.min(100, readWord16(blockBytes, 206));
  const magic = readWord16(blockBytes, 230);
  const label = readAsciiFixed(blockBytes, 240, 16) || presetHint;
  const drive = readAsciiFixed(blockBytes, 256, 16) || 'RK05';
  const presetId: DiskPresetId = magic === PDP11_UNIX_V6_SUPERBLOCK_MAGIC
    ? 'v6-rk05'
    : magic === PDP11_RSX11M_SUPERBLOCK_MAGIC
      ? 'rsx11m-rx01'
      : 'bare-metal';
  return {
    presetId,
    magic,
    magicOctal: octal16(magic),
    inodeBlocks,
    volumeTotalBlocks,
    freeCount,
    freeBlocks,
    freeInodeCount,
    label,
    drive,
  };
}

export function parseUnixV6Inode(
  blockBytes: Uint8Array,
  slotIndex: number,
): {
  readonly mode: number;
  readonly modeOctal: string;
  readonly nlink: number;
  readonly uid: number;
  readonly gid: number;
  readonly sizeBytes: number;
  readonly addr: readonly number[];
} {
  if (slotIndex < 0 || slotIndex >= 16 || (slotIndex + 1) * 32 > blockBytes.byteLength) {
    throw new RangeError(`Inode slot ${slotIndex} out of bounds`);
  }
  const off = slotIndex * 32;
  const mode = readWord16(blockBytes, off + 0);
  const nlink = blockBytes[off + 2];
  const uid = blockBytes[off + 3];
  const gid = blockBytes[off + 4];
  const sizeHi = blockBytes[off + 5];
  const sizeLo = readWord16(blockBytes, off + 6);
  const addr: number[] = [];
  for (let i = 0; i < 8; i++) {
    const w = readWord16(blockBytes, off + 8 + i * 2);
    if (w !== 0) addr.push(w);
  }
  return {
    mode,
    modeOctal: octal16(mode),
    nlink,
    uid,
    gid,
    sizeBytes: (sizeHi << 16) | sizeLo,
    addr,
  };
}

export function parseDirectoryBlock(blockBytes: Uint8Array): readonly { readonly ino: number; readonly name: string }[] {
  const entries: { readonly ino: number; readonly name: string }[] = [];
  for (let off = 0; off + 16 <= blockBytes.byteLength; off += 16) {
    const ino = readWord16(blockBytes, off);
    if (ino === 0) continue;
    const name = readAsciiFixed(blockBytes, off + 2, 14);
    entries.push({ ino, name });
  }
  return entries;
}

export function formatBlockHexDump(
  blockBytes: Uint8Array,
  blockNum = 0,
  options: { readonly radix?: 'octal' | 'hex' | 'both'; readonly bytesPerLine?: number; readonly maxLines?: number } = {},
): string {
  const radix = options.radix ?? 'both';
  const bytesPerLine = options.bytesPerLine ?? 16;
  const maxLines = options.maxLines ?? 32;
  const lines: string[] = [
    `BLK ${octal16(blockNum)} (${blockNum}) :: ${blockBytes.byteLength} B (${blockBytes.byteLength >> 1} PDP-11 words)`,
  ];
  const totalLines = Math.min(maxLines, Math.ceil(blockBytes.byteLength / bytesPerLine));
  for (let lineIdx = 0; lineIdx < totalLines; lineIdx++) {
    const off = lineIdx * bytesPerLine;
    const octWords: string[] = [];
    const hexWords: string[] = [];
    let ascii = '';
    for (let i = 0; i < bytesPerLine; i += 2) {
      if (off + i + 1 < blockBytes.byteLength) {
        const w = readWord16(blockBytes, off + i);
        octWords.push(octal16(w));
        hexWords.push(w.toString(16).padStart(4, '0'));
      }
      for (let b = 0; b < 2 && off + i + b < blockBytes.byteLength; b++) {
        const ch = blockBytes[off + i + b];
        ascii += ch >= 32 && ch <= 126 ? String.fromCharCode(ch) : '.';
      }
    }
    const offTag = octal16(off);
    if (radix === 'octal') {
      lines.push(`${offTag}: ${octWords.join(' ')} | ${ascii}`);
    } else if (radix === 'hex') {
      lines.push(`${offTag}: ${hexWords.join(' ')} | ${ascii}`);
    } else {
      lines.push(`${offTag}: ${octWords.join(' ')} | ${hexWords.join(' ')} | ${ascii}`);
    }
  }
  return lines.join('\n');
}

export function runPdp11Demo(
  cpuPct = 34.5,
  memPct = 61.2,
  procCount = 48,
  seq = 1,
  presetId: DiskPresetId = 'bare-metal',
): Pdp11StateSnapshot {
  const vm = new Pdp11Machine(0o001000);
  vm.switchReg = 0o125252;
  if (presetId !== 'bare-metal') {
    vm.write16(B8G_PDP11_MMR0, 1);
  }
  vm.loadProgram(assembleTelemetryMonitorProgram(0o001000));
  vm.injectTelemetry(Math.round(cpuPct * 10), Math.round(memPct * 10), procCount, 420, seq);
  vm.run(300);
  return vm.getStateSnapshot();
}

if (import.meta.main) {
  const snap = runPdp11Demo();
  const v6 = buildUnixV6DiskImage();
  const rsx = buildRsx11mDiskImage();
  console.log(JSON.stringify({
    schema: 'b8g-pdp11-demo.v2',
    abiMagic: `0x${B8G_PDP11_ABI_MAGIC.toString(16).toUpperCase()}`,
    v3Magic: `0x${B8G_ABI_MAGIC_V3.toString(16).toUpperCase()}`,
    halted: snap.halted,
    cycleCount: snap.cycleCount,
    kl11Output: snap.txText.trim(),
    octalRegs: snap.octalRegs,
    diskPresets: {
      v6: { label: v6.label, magic: v6.superblock.magicOctal, inodes: v6.inodes.length, freeBlocks: v6.superblock.freeBlocks },
      rsx11m: { label: rsx.label, magic: rsx.superblock.magicOctal, inodes: rsx.inodes.length, freeBlocks: rsx.superblock.freeBlocks },
    },
  }, null, 2));
}
