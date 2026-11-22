// Tiny stack VM for make.fun's tiny-stack-vm-01 (ISA v1, see kit ISA.md).
// One run answers every instance in MAKEFUN_INPUT_DIR (default /input):
// for each <id> it reads program.bin + input.bin and writes
// <id>/stdout.bin and <id>/exit.txt under MAKEFUN_OUTPUT_DIR (default /output).
// Node 22, no dependencies. All 32-bit arithmetic wraps; traps keep prior output.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// opcode -> [immediate bytes, values popped, values pushed]
const INFO: Record<number, [number, number, number]> = {
  0x00: [0, 0, 0], 0x01: [1, 0, 1], 0x02: [4, 0, 1], 0x03: [0, 1, 0],
  0x04: [0, 1, 2], 0x05: [0, 2, 2], 0x06: [0, 2, 3], 0x07: [0, 3, 3],
  0x10: [0, 2, 1], 0x11: [0, 2, 1], 0x12: [0, 2, 1], 0x13: [0, 2, 1],
  0x14: [0, 2, 1], 0x15: [0, 2, 1], 0x16: [0, 2, 1], 0x17: [0, 1, 1],
  0x18: [0, 2, 1], 0x19: [0, 2, 1], 0x1a: [0, 2, 1], 0x1b: [0, 1, 1],
  0x1c: [0, 2, 1], 0x1d: [0, 2, 1], 0x1e: [0, 2, 1], 0x20: [0, 2, 1],
  0x21: [0, 2, 1], 0x22: [0, 2, 1], 0x30: [2, 0, 0], 0x31: [2, 1, 0],
  0x32: [2, 1, 0], 0x33: [2, 0, 0], 0x34: [0, 0, 0], 0x40: [0, 1, 1],
  0x41: [0, 2, 0], 0x50: [0, 1, 0], 0x51: [0, 1, 0], 0x52: [0, 0, 1],
  0x53: [0, 1, 0],
};

function run(prog: Uint8Array, input: Uint8Array): { out: Uint8Array; code: number } {
  const st = new Int32Array(256); // data stack
  let sp = 0;
  const cs = new Int32Array(64); // call stack (return addresses)
  let cp = 0;
  const mem = new Int32Array(256);
  const out = new Uint8Array(65536);
  let ol = 0;
  let ip = 0;
  let pc = 0;
  let steps = 0;
  const n = prog.length;
  const end = (code: number) => ({ out: out.slice(0, ol), code });

  for (;;) {
    if (steps === 1000000) return end(10); // step limit
    if (pc < 0 || pc >= n) return end(9); // pc outside program
    const op = prog[pc];
    const info = INFO[op];
    if (!info) return end(5); // unknown opcode
    const [imm, pops, pushes] = info;
    if (pc + imm >= n) return end(9); // immediate cut off by end
    steps++;
    const nx = pc + 1 + imm; // address of the next instruction
    if (sp < pops) return end(2); // stack underflow
    if (sp - pops + pushes > 256) return end(3); // stack overflow
    pc = nx;
    switch (op) {
      case 0x00: return end(0); // HALT
      case 0x01: st[sp++] = (prog[nx - 1] << 24) >> 24; break; // PUSH8, sign-extended
      case 0x02: // PUSH32, little-endian signed
        st[sp++] = prog[nx - 4] | (prog[nx - 3] << 8) | (prog[nx - 2] << 16) | (prog[nx - 1] << 24);
        break;
      case 0x03: sp--; break; // POP
      case 0x04: st[sp] = st[sp - 1]; sp++; break; // DUP
      case 0x05: { const t = st[sp - 1]; st[sp - 1] = st[sp - 2]; st[sp - 2] = t; break; } // SWAP
      case 0x06: st[sp] = st[sp - 2]; sp++; break; // OVER
      case 0x07: { const a = st[sp - 3]; st[sp - 3] = st[sp - 2]; st[sp - 2] = st[sp - 1]; st[sp - 1] = a; break; } // ROT
      case 0x17: st[sp - 1] = (-st[sp - 1]) | 0; break; // NEG (wraps at INT_MIN)
      case 0x1b: st[sp - 1] = ~st[sp - 1]; break; // NOT
      case 0x10: case 0x11: case 0x12: case 0x13: case 0x14: case 0x15: case 0x16:
      case 0x18: case 0x19: case 0x1a: case 0x1c: case 0x1d: case 0x1e:
      case 0x20: case 0x21: case 0x22: {
        const b = st[sp - 1];
        const a = st[sp - 2];
        let r: number;
        if (op === 0x10) r = (a + b) | 0;
        else if (op === 0x11) r = (a - b) | 0;
        else if (op === 0x12) r = Math.imul(a, b); // exact low 32 bits
        else if (op === 0x13) { if (b === 0) return end(4); r = a === -2147483648 && b === -1 ? a : (a / b) | 0; }
        else if (op === 0x14) { if (b === 0) return end(4); r = b === -1 ? 0 : (a % b) | 0; }
        else if (op === 0x15) { if (b === 0) return end(4); r = Math.floor((a >>> 0) / (b >>> 0)) | 0; }
        else if (op === 0x16) { if (b === 0) return end(4); r = ((a >>> 0) % (b >>> 0)) | 0; }
        else if (op === 0x18) r = a & b;
        else if (op === 0x19) r = a | b;
        else if (op === 0x1a) r = a ^ b;
        else if (op === 0x1c) r = a << (b & 31);
        else if (op === 0x1d) r = a >> (b & 31);
        else if (op === 0x1e) r = (a >>> (b & 31)) | 0;
        else if (op === 0x20) r = a === b ? 1 : 0;
        else if (op === 0x21) r = a < b ? 1 : 0;
        else r = (a >>> 0) < (b >>> 0) ? 1 : 0; // LTU
        sp -= 2;
        st[sp++] = r;
        break;
      }
      case 0x30: case 0x31: case 0x32: { // JMP / JZ / JNZ, signed 16-bit offset
        const rel = ((prog[nx - 2] | (prog[nx - 1] << 8)) << 16) >> 16;
        let take = true;
        if (op !== 0x30) { const v = st[--sp]; take = op === 0x31 ? v === 0 : v !== 0; }
        if (take) pc = nx + rel;
        break;
      }
      case 0x33: // CALL, unsigned 16-bit target
        if (cp === 64) return end(7);
        cs[cp++] = nx;
        pc = prog[nx - 2] | (prog[nx - 1] << 8);
        break;
      case 0x34: // RET
        if (cp === 0) return end(8);
        pc = cs[--cp];
        break;
      case 0x40: { // LOAD
        const addr = st[sp - 1];
        if (addr < 0 || addr > 255) return end(6);
        st[sp - 1] = mem[addr];
        break;
      }
      case 0x41: { // STORE (v addr --)
        const addr = st[sp - 1];
        const v = st[sp - 2];
        if (addr < 0 || addr > 255) return end(6);
        sp -= 2;
        mem[addr] = v;
        break;
      }
      case 0x50: { // PRINT: decimal ASCII, no newline
        const s = String(st[sp - 1]);
        if (ol + s.length > 65536) return end(11);
        sp--;
        for (let i = 0; i < s.length; i++) out[ol++] = s.charCodeAt(i);
        break;
      }
      case 0x51: // PUTC: one byte
        if (ol + 1 > 65536) return end(11);
        out[ol++] = st[--sp] & 255;
        break;
      case 0x52: st[sp++] = ip < input.length ? input[ip++] : -1; break; // IN
      case 0x53: return end(st[--sp] & 255); // EXIT: low byte
    }
  }
}

const IN_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

for (const id of readdirSync(IN_DIR).sort()) {
  let prog: Buffer;
  try { prog = readFileSync(join(IN_DIR, id, 'program.bin')); } catch { continue; }
  let input = new Uint8Array(0);
  try { input = readFileSync(join(IN_DIR, id, 'input.bin')); } catch { /* no input */ }
  const { out, code } = run(prog, input);
  mkdirSync(join(OUT_DIR, id), { recursive: true });
  writeFileSync(join(OUT_DIR, id, 'stdout.bin'), out);
  writeFileSync(join(OUT_DIR, id, 'exit.txt'), String(code) + '\n');
}
