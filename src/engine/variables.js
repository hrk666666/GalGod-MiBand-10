/**
 * variables.js — VN 引擎变量系统
 *
 * 平台无关。负责：
 *  - 变量存储（flags）
 *  - 剧本指令执行：f.x = 1 / f.x++ / f.x-- / f.x += 2 / f.x = rand(1,10)
 *  - 条件表达式求值（选项可用性 / 分支判断）：
 *      f.flag >= 3 && f.item == "key" || !f.done
 *
 * 表达式用递归下降手写解析，不用 eval，避免脚本注入。
 */

// ---------- 词法 ----------
const TOKEN_RE = /^(\s+)|^(==|!=|>=|<=|&&|\|\||[()+\-*\/!<>=,])|^('[^']*'|"[^"]*")|^(\d+\.?\d*)|^([A-Za-z_][A-Za-z0-9_]*)/

class Lexer {
  constructor(src) {
    this.src = src
    this.pos = 0
    this.tokens = []
    this._tokenize()
  }
  _tokenize() {
    const s = this.src
    while (this.pos < s.length) {
      const rest = s.slice(this.pos)
      const m = TOKEN_RE.exec(rest)
      if (!m) {
        // 未知字符跳过（容错，不抛错）
        this.pos++
        continue
      }
      if (m[1]) { this.pos += m[1].length; continue } // 空白
      if (m[2]) { this.tokens.push({ t: m[2] }); this.pos += m[2].length; continue }
      if (m[3]) { this.tokens.push({ t: "str", v: m[3].slice(1, -1) }); this.pos += m[3].length; continue }
      if (m[4]) { this.tokens.push({ t: "num", v: parseFloat(m[4]) }); this.pos += m[4].length; continue }
      if (m[5]) { this.tokens.push({ t: "id", v: m[5] }); this.pos += m[5].length; continue }
    }
    this.tokens.push({ t: "eof" })
  }
  peek() { return this.tokens[0] }
  next() { return this.tokens.shift() }
}

/**
 * 按"顶层逗号"分割指令串：括号深度为 0 且不在字符串字面量内的逗号才是分隔符，
 * 避免拆坏 rand(a,b)、字符串 "a,b"。
 */
function splitTopLevel(script) {
  const parts = []
  let depth = 0
  let quote = null
  let cur = ""
  for (const ch of script) {
    if (quote) {
      cur += ch
      if (ch === quote) quote = null
      continue
    }
    if (ch === "'" || ch === '"') { quote = ch; cur += ch; continue }
    if (ch === "(") { depth++; cur += ch; continue }
    if (ch === ")") { depth--; cur += ch; continue }
    if (ch === "," && depth === 0) { parts.push(cur); cur = ""; continue }
    cur += ch
  }
  if (cur.trim()) parts.push(cur)
  return parts
}

/**
 * 变量系统
 */
export class Variables {
  /**
   * @param {Object} initial 初始变量表（game.json 的 initialState.flags）
   */
  constructor(initial = {}) {
    this.flags = Object.assign({}, initial)
  }

  get(name) { return this.flags[name] }
  set(name, value) { this.flags[name] = value }
  reset(initial = {}) { this.flags = Object.assign({}, initial) }

  /** 判断变量名是否以 f. 开头，统一剥掉前缀 */
  _name(raw) {
    let n = raw.trim()
    if (n.startsWith("f.")) n = n.slice(2)
    return n
  }

  /**
   * 执行一串剧本指令（逗号分隔）
   * 支持：f.x = expr | f.x = rand(a,b) | f.x++ | f.x-- | f.x += n | f.x -= n
   */
  run(script) {
    if (script === null || script === undefined) return
    for (const cmd of splitTopLevel(String(script))) {
      if (!cmd.trim()) continue
      this._execStatement(cmd.trim())
    }
  }

  _execStatement(cmd) {
    // 自增 / 自减
    const inc = /^f\.[A-Za-z_][A-Za-z0-9_]*\s*(\+\+|--)$/.exec(cmd)
    if (inc) {
      const name = this._name(inc[0].replace(/^\s*/, "").replace(/\s*(\+\+|--)$/, ""))
      this.flags[name] = (this.flags[name] || 0) + (inc[1] === "++" ? 1 : -1)
      return
    }

    // 赋值（含 += / -=）
    const assign = /^f\.([A-Za-z_][A-Za-z0-9_]*)\s*(\+=|-=|=)\s*(.+)$/.exec(cmd)
    if (assign) {
      const name = assign[1]
      const op = assign[2]
      const value = this._evalValue(assign[3])
      if (op === "=") this.flags[name] = value
      else if (op === "+=") this.flags[name] = (this.flags[name] || 0) + value
      else if (op === "-=") this.flags[name] = (this.flags[name] || 0) - value
      return
    }

    // 裸 "f.xxx"（视为取变量，无副作用；容错）
  }

  /**
   * 条件表达式求值，返回 true/false
   * 支持：比较 == != > < >= <=，逻辑 && || !，变量 f.x，数字/字符串，rand(a,b)
   */
  evalCondition(expr) {
    if (expr === null || expr === undefined || expr === "") return true
    const lexer = new Lexer(String(expr))
    const val = this._parseOr(lexer)
    return Boolean(val)
  }

  /** 值表达式：数字 / 字符串 / f.x / rand(a,b) / 括号 */
  _evalValue(expr) {
    const lexer = new Lexer(String(expr))
    const val = this._parseOr(lexer)
    return val
  }

  // or -> and (|| and)*
  _parseOr(lex) {
    let left = this._parseAnd(lex)
    while (lex.peek().t === "||") {
      lex.next()
      const right = this._parseAnd(lex)
      left = Boolean(left) || Boolean(right)
    }
    return left
  }

  // and -> cmp (&& cmp)*
  _parseAnd(lex) {
    let left = this._parseCmp(lex)
    while (lex.peek().t === "&&") {
      lex.next()
      const right = this._parseCmp(lex)
      left = Boolean(left) && Boolean(right)
    }
    return left
  }

  // cmp -> unary (op unary)?
  _parseCmp(lex) {
    let left = this._parseUnary(lex)
    const op = lex.peek().t
    if (op === "==" || op === "!=" || op === ">" || op === "<" || op === ">=" || op === "<=") {
      lex.next()
      const right = this._parseUnary(lex)
      switch (op) {
        case "==": return left == right
        case "!=": return left != right
        case ">": return left > right
        case "<": return left < right
        case ">=": return left >= right
        case "<=": return left <= right
      }
    }
    return left
  }

  // unary -> ! unary | primary
  _parseUnary(lex) {
    if (lex.peek().t === "!") {
      lex.next()
      return !Boolean(this._parseUnary(lex))
    }
    return this._parsePrimary(lex)
  }

  _parsePrimary(lex) {
    const tok = lex.next()
    if (tok.t === "num") return tok.v
    if (tok.t === "str") return tok.v
    if (tok.t === "id") {
      if (tok.v === "rand") {
        lex.next() // (
        const a = this._parseOr(lex)
        lex.next() // ,
        const b = this._parseOr(lex)
        lex.next() // )
        return a + Math.floor(Math.random() * (b - a + 1))
      }
      if (tok.v === "f") {
        // f.xxx
        const nameTok = lex.next()
        const name = nameTok.v
        const v = this.flags[name]
        return v === undefined ? 0 : v
      }
      // 布尔关键字
      if (tok.v === "true") return true
      if (tok.v === "false") return false
      return 0
    }
    if (tok.t === "(") {
      const val = this._parseOr(lex)
      lex.next() // )
      return val
    }
    return 0
  }
}

export default Variables
