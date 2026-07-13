// Pure computation tools (no eval, no side effects). The calculator keeps its original
// { result } / { error } contract; a stats tool covers the common reductions.

import type { Tool } from "./ToolTypes.ts";
import { Err, RequireString } from "./ToolArgs.ts";

// Two-operand arithmetic. Args: { a: number, op: '+'|'-'|'*'|'/'|'^'|'%', b: number }.
export const CalculatorTool: Tool = {
  Name: "calculator",
  Description: "Arithmetic on two numbers.",
  Args: "{ a: number, op: '+'|'-'|'*'|'/'|'^'|'%', b: number }",
  Execute: (Arguments) => {
    const A = Number(Arguments["a"]);
    const B = Number(Arguments["b"]);
    const Op = String(Arguments["op"]);
    if (!Number.isFinite(A) || !Number.isFinite(B)) return Err("a and b must be numbers");
    switch (Op) {
      case "+": return { result: A + B };
      case "-": return { result: A - B };
      case "*": return { result: A * B };
      case "/": return B === 0 ? Err("division by zero") : { result: A / B };
      case "^": return { result: A ** B };
      case "%": return B === 0 ? Err("modulo by zero") : { result: A % B };
      default: return Err(`unknown op: ${Op}`);
    }
  },
};

// Reductions over a list of numbers. Args: { values: number[], op: 'sum'|'mean'|'min'|'max'|'count' }.
export const StatsTool: Tool = {
  Name: "stats",
  Description: "Reduce a list of numbers.",
  Args: "{ values: number[], op: 'sum'|'mean'|'min'|'max'|'count' }",
  Execute: (Arguments) => {
    const Raw = Arguments["values"];
    if (!Array.isArray(Raw)) return Err("values must be an array of numbers");
    const Values = Raw.map(Number).filter((V) => Number.isFinite(V));
    if (Values.length === 0) return Err("no finite numbers in values");
    const Op = RequireString(Arguments, "op");
    const Sum = Values.reduce((Acc, V) => Acc + V, 0);
    switch (Op) {
      case "sum": return { result: Sum };
      case "mean": return { result: Sum / Values.length };
      case "min": return { result: Math.min(...Values) };
      case "max": return { result: Math.max(...Values) };
      case "count": return { result: Values.length };
      default: return Err(`unknown op: ${Op}`);
    }
  },
};
