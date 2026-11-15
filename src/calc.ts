// The calculator's arithmetic: an expression read by hand, as the page may
// not eval. + - × ÷, ^ (right to left), mod, x% = x/100, x!, parentheses,
// 2π for 2×π, hexadecimal 0xff, binary 0b101, octal 0o17, and the
// functions below; trigonometry in degrees or radians.

const consts: Record<string, number> = { pi: Math.PI, π: Math.PI, e: Math.E };

const fns: Record<string, (deg: boolean) => (...a: number[]) => number> = {
  sin: (deg) => (x) => Math.sin(deg ? (x * Math.PI) / 180 : x),
  cos: (deg) => (x) => Math.cos(deg ? (x * Math.PI) / 180 : x),
  tan: (deg) => (x) => {
    if (deg && Math.abs(x % 180) === 90) throw new Error("tan 90° 没有值");
    return Math.tan(deg ? (x * Math.PI) / 180 : x);
  },
  asin: (deg) => (x) => Math.asin(x) * (deg ? 180 / Math.PI : 1),
  acos: (deg) => (x) => Math.acos(x) * (deg ? 180 / Math.PI : 1),
  atan: (deg) => (x) => Math.atan(x) * (deg ? 180 / Math.PI : 1),
  sqrt: () => Math.sqrt,
  cbrt: () => Math.cbrt,
  abs: () => Math.abs,
  ln: () => Math.log,
  log: () => (x, base) => (base === undefined ? Math.log10(x) : Math.log(x) / Math.log(base)),
  lg: () => Math.log10,
  exp: () => Math.exp,
  round: () => (x, d = 0) => Math.round(x * 10 ** d) / 10 ** d,
  floor: () => Math.floor,
  ceil: () => Math.ceil,
  min: () => Math.min,
  max: () => Math.max,
};

export const calcFunctions = Object.keys(fns);

type Tok = { t: "num"; v: number } | { t: "id"; v: string } | { t: "op"; v: string };

function tokens(src: string): Tok[] {
  // Full-width and display signs, as typed with a Chinese input method or
  // the keypad.
  const s = src
    .replace(/[×＊]/g, "*")
    .replace(/[÷／]/g, "/")
    .replace(/[−－—]/g, "-")
    .replace(/＋/g, "+")
    .replace(/（/g, "(")
    .replace(/）/g, ")")
    .replace(/，/g, ",")
    .replace(/％/g, "%")
    .replace(/√/g, "sqrt")
    .replace(/\*\*/g, "^");
  const out: Tok[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i]!;
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    const m =
      s.slice(i).match(/^0x[0-9a-f]+|^0b[01]+|^0o[0-7]+/i) ?? s.slice(i).match(/^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i);
    if (m) {
      const v = /^0[xbo]/i.test(m[0]) ? Number(m[0].toLowerCase()) : parseFloat(m[0]);
      out.push({ t: "num", v });
      i += m[0].length;
      continue;
    }
    const id = s.slice(i).match(/^[a-zπ]+/i);
    if (id) {
      out.push({ t: "id", v: id[0].toLowerCase() });
      i += id[0].length;
      continue;
    }
    if ("+-*/^%!(),".includes(c)) {
      out.push({ t: "op", v: c });
      i++;
      continue;
    }
    throw new Error(`看不懂「${c}」`);
  }
  return out;
}

// calc works an expression out. ans is what the last one came to.
export function calc(src: string, deg = true, ans = 0): number {
  const ts = tokens(src);
  if (!ts.length) throw new Error("没有算式");
  let i = 0;
  const peek = () => ts[i];
  const isOp = (v: string) => peek()?.t === "op" && peek()!.v === v;
  const expect = (v: string) => {
    if (!isOp(v)) throw new Error(v === ")" ? "少了右括号" : `这里要「${v}」`);
    i++;
  };
  const expr = (): number => {
    let v = term();
    while (isOp("+") || isOp("-")) v = ts[i++]!.v === "+" ? v + term() : v - term();
    return v;
  };
  // A factor follows another with no sign between, as 2π or 3(1+2): times.
  const startsFactor = () => {
    const t = peek();
    return !!t && (t.t === "num" || t.t === "id" || (t.t === "op" && t.v === "(")) && !(t.t === "id" && t.v === "mod");
  };
  const term = (): number => {
    let v = unary();
    for (;;) {
      if (isOp("*")) i++, (v *= unary());
      else if (isOp("/")) {
        i++;
        const d = unary();
        if (d === 0) throw new Error("不能除以 0");
        v /= d;
      } else if (peek()?.t === "id" && peek()!.v === "mod") {
        i++;
        const d = unary();
        if (d === 0) throw new Error("不能对 0 取余");
        v = ((v % d) + d) % d;
      } else if (startsFactor()) v *= power();
      else return v;
    }
  };
  // -2^2 is -(2^2), as on paper.
  const unary = (): number => {
    if (isOp("-")) return i++, -unary();
    if (isOp("+")) return i++, unary();
    return power();
  };
  const power = (): number => {
    const b = postfix();
    if (isOp("^")) {
      i++;
      return b ** unary();
    }
    return b;
  };
  const postfix = (): number => {
    let v = primary();
    for (;;) {
      if (isOp("%")) i++, (v /= 100);
      else if (isOp("!")) {
        i++;
        if (v < 0 || !Number.isInteger(v)) throw new Error("阶乘只能算非负整数");
        if (v > 170) throw new Error("数太大");
        let f = 1;
        for (let k = 2; k <= v; k++) f *= k;
        v = f;
      } else return v;
    }
  };
  const primary = (): number => {
    const t = ts[i++];
    if (!t) throw new Error("算式没写完");
    if (t.t === "num") return t.v;
    if (t.t === "op" && t.v === "(") {
      const v = expr();
      // An unclosed parenthesis at the end is closed, as while typing.
      if (peek()) expect(")");
      return v;
    }
    if (t.t === "id") {
      if (t.v === "ans") return ans;
      if (t.v in consts) return consts[t.v]!;
      const f = fns[t.v];
      if (!f) throw new Error(`不认识「${t.v}」`);
      // sqrt 9 as well as sqrt(9).
      if (!isOp("(")) return f(deg)(power());
      i++;
      const args = [expr()];
      while (isOp(",")) i++, args.push(expr());
      if (peek()) expect(")");
      return f(deg)(...args);
    }
    throw new Error(`这里不能是「${t.v}」`);
  };
  const v = expr();
  if (i < ts.length) throw new Error(ts[i]!.v === ")" ? "多了右括号" : `多出来「${ts[i]!.v}」`);
  if (Number.isNaN(v)) throw new Error("没有结果（超出定义域）");
  if (!Number.isFinite(v)) throw new Error("结果太大");
  return v;
}

// tidy drops the binary noise: 0.1+0.2 is 0.3.
export function tidy(v: number): number {
  return v === 0 ? 0 : parseFloat(v.toPrecision(14));
}

// show writes a result out, without grouping.
export function show(v: number): string {
  const t = tidy(v);
  const a = Math.abs(t);
  if (a !== 0 && (a >= 1e21 || a < 1e-9)) return t.toExponential().replace(/e\+?/, "e");
  return String(t).includes("e") ? t.toFixed(20).replace(/\.?0+$/, "") : String(t);
}
