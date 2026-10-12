export type AngleMode = 'rad' | 'deg';

export type BinaryOperator = '+' | '-' | '*' | '/' | '%' | '^';
export type UnaryOperator = '+' | '-';

interface Located {
  readonly start: number;
  readonly end: number;
}

export interface NumberNode extends Located {
  readonly kind: 'number';
  readonly value: number;
}

export interface VariableNode extends Located {
  readonly kind: 'variable';
  readonly name: string;
}

export interface UnaryNode extends Located {
  readonly kind: 'unary';
  readonly op: UnaryOperator;
  readonly operand: Expr;
}

export interface BinaryNode extends Located {
  readonly kind: 'binary';
  readonly op: BinaryOperator;
  readonly left: Expr;
  readonly right: Expr;
}

export interface FactorialNode extends Located {
  readonly kind: 'factorial';
  readonly operand: Expr;
}

export interface CallNode extends Located {
  readonly kind: 'call';
  readonly name: string;
  readonly args: readonly Expr[];
}

export type Expr = NumberNode | VariableNode | UnaryNode | BinaryNode | FactorialNode | CallNode;

export interface AssignmentStatement {
  readonly kind: 'assignment';
  readonly name: string;
  readonly value: Expr;
}

export interface ExpressionStatement {
  readonly kind: 'expression';
  readonly expr: Expr;
}

export type Statement = AssignmentStatement | ExpressionStatement;
