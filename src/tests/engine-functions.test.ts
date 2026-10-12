import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { assertCalcError, calc } from './helpers.ts';

describe('trigonometry in radians', () => {
  it('computes the basic functions', () => {
    assert.equal(calc('sin(0)'), 0);
    assert.equal(calc('cos(0)'), 1);
    assert.equal(calc('sin(pi / 2)'), 1);
    assert.equal(calc('tan(pi / 4)'), 1);
    assert.equal(calc('sin(1)'), 0.841470984808);
  });

  it('snaps exact zeros', () => {
    assert.equal(calc('sin(pi)'), 0);
    assert.equal(calc('sin(2 * pi)'), 0);
    assert.equal(calc('cos(pi / 2)'), 0);
    assert.equal(calc('cos(3 * pi / 2)'), 0);
    assert.equal(calc('cos(pi)'), -1);
  });

  it('keeps tiny non-zero results near zero', () => {
    assert.equal(calc('sin(1e-20)'), 1e-20);
  });

  it('computes inverse functions', () => {
    assert.equal(calc('asin(1)'), 1.57079632679);
    assert.equal(calc('acos(1)'), 0);
    assert.equal(calc('atan(1)'), 0.785398163397);
    assert.equal(calc('atan2(1, 1)'), 0.785398163397);
  });

  it('rejects tan at its poles and inverse trig outside the domain', () => {
    assertCalcError('tan(pi / 2)', { kind: 'math', message: /tan is undefined/ });
    assertCalcError('asin(2)', { kind: 'math', message: /asin is only defined/ });
    assertCalcError('acos(-1.5)', { kind: 'math', message: /acos is only defined/ });
  });
});

describe('trigonometry in degrees', () => {
  it('is exact at multiples of 90 degrees', () => {
    assert.equal(calc('sin(30)', {}, 'deg'), 0.5);
    assert.equal(calc('sin(90)', {}, 'deg'), 1);
    assert.equal(calc('sin(180)', {}, 'deg'), 0);
    assert.equal(calc('sin(270)', {}, 'deg'), -1);
    assert.equal(calc('sin(-90)', {}, 'deg'), -1);
    assert.equal(calc('cos(0)', {}, 'deg'), 1);
    assert.equal(calc('cos(90)', {}, 'deg'), 0);
    assert.equal(calc('cos(180)', {}, 'deg'), -1);
    assert.equal(calc('cos(60)', {}, 'deg'), 0.5);
    assert.equal(calc('sin(720)', {}, 'deg'), 0);
  });

  it('computes tangent and rejects its poles', () => {
    assert.equal(calc('tan(45)', {}, 'deg'), 1);
    assert.equal(calc('tan(180)', {}, 'deg'), 0);
    assertCalcError('tan(90)', { kind: 'math', message: /tan is undefined/ }, {}, 'deg');
    assertCalcError('tan(270)', { kind: 'math', message: /tan is undefined/ }, {}, 'deg');
  });

  it('returns degrees from inverse functions', () => {
    assert.equal(calc('asin(1)', {}, 'deg'), 90);
    assert.equal(calc('acos(0)', {}, 'deg'), 90);
    assert.equal(calc('atan(1)', {}, 'deg'), 45);
    assert.equal(calc('atan2(1, -1)', {}, 'deg'), 135);
  });

  it('treats the same input differently per mode', () => {
    assert.notEqual(calc('sin(90)', {}, 'rad'), calc('sin(90)', {}, 'deg'));
  });
});

describe('logarithms, exponentials and roots', () => {
  it('computes logarithms', () => {
    assert.equal(calc('ln(e)'), 1);
    assert.equal(calc('ln(1)'), 0);
    assert.equal(calc('log10(1000)'), 3);
    assert.equal(calc('log(100)'), 2);
    assert.equal(calc('log2(1024)'), 10);
  });

  it('rejects logarithms of non-positive numbers', () => {
    assertCalcError('ln(0)', { kind: 'math', message: /ln is only defined/ });
    assertCalcError('ln(-1)', { kind: 'math', message: /ln is only defined/ });
    assertCalcError('log10(0)', { kind: 'math', message: /log10 is only defined/ });
    assertCalcError('log2(-8)', { kind: 'math', message: /log2 is only defined/ });
  });

  it('computes exponentials and powers', () => {
    assert.equal(calc('exp(0)'), 1);
    assert.equal(calc('exp(1)'), 2.71828182846);
    assert.equal(calc('pow(2, 10)'), 1024);
    assert.equal(calc('2 ^ 0.5'), 1.41421356237);
    assertCalcError('exp(1000)', { kind: 'math', message: /too large/ });
  });

  it('computes roots', () => {
    assert.equal(calc('sqrt(144)'), 12);
    assert.equal(calc('cbrt(-27)'), -3);
    assertCalcError('sqrt(-4)', { kind: 'math', message: /sqrt is only defined/ });
  });

  it('computes hyperbolic functions', () => {
    assert.equal(calc('sinh(0)'), 0);
    assert.equal(calc('cosh(0)'), 1);
    assert.equal(calc('tanh(0)'), 0);
  });
});

describe('utility functions', () => {
  it('computes abs, floor, ceil and round', () => {
    assert.equal(calc('abs(-3.5)'), 3.5);
    assert.equal(calc('floor(-1.5)'), -2);
    assert.equal(calc('ceil(1.2)'), 2);
    assert.equal(calc('round(2.5)'), 3);
    assert.equal(calc('round(-2.5)'), -3);
    assert.equal(calc('round(3.14159, 2)'), 3.14);
  });

  it('rejects invalid rounding digits', () => {
    assertCalcError('round(1, 2.5)', { kind: 'math', message: /whole number/ });
    assertCalcError('round(1, 16)', { kind: 'math', message: /between 0 and 15/ });
    assertCalcError('round(1, -1)', { kind: 'math', message: /between 0 and 15/ });
  });

  it('computes min and max over any number of arguments', () => {
    assert.equal(calc('min(3)'), 3);
    assert.equal(calc('max(1, 9, 4)'), 9);
    assert.equal(calc('min(5, -2, 8, 0)'), -2);
  });

  it('nests function calls', () => {
    assert.equal(calc('max(sqrt(16), min(10, 2 + 3), abs(-1))'), 5);
    assert.equal(calc('sqrt(abs(-16))'), 4);
  });
});

describe('financial functions', () => {
  it('computes compound interest A = P(1 + r/n)^(nt)', () => {
    assert.equal(calc('compound(1000, 0.05, 12, 10)'), 1647.00949769);
    assert.equal(calc('compound(1000, 0.05, 1, 1)'), 1050);
    assert.equal(calc('compound(2000, 0, 4, 5)'), 2000);
  });

  it('rejects non-positive compounding periods', () => {
    assertCalcError('compound(1000, 0.05, 0, 10)', { kind: 'math', message: /greater than 0/ });
    assertCalcError('compound(1000, 0.05, -4, 10)', { kind: 'math', message: /greater than 0/ });
  });

  it('computes amortized loan payments', () => {
    assert.equal(calc('pmt(200000, 0.06, 30)'), 1199.10105031);
    assert.equal(calc('pmt(10000, 0.05, 1, 12)'), 856.074817885);
    assert.equal(calc('pmt(1200, 0, 1)'), 100);
    assert.equal(calc('pmt(1000, 0.1, 1, 1)'), 1100);
  });

  it('rejects impossible loans', () => {
    assertCalcError('pmt(1000, 0.05, 0.5, 1)', { kind: 'math', message: /whole number/ });
    assertCalcError('pmt(1000, 0.05, 0)', { kind: 'math', message: /at least one payment/ });
    assertCalcError('pmt(1000, 0.05, 1, 0)', { kind: 'math', message: /greater than 0/ });
    assertCalcError('pmt(1000, -13, 1, 12)', { kind: 'math', message: /greater than -100%/ });
  });

  it('computes net present value with the first flow at t = 0', () => {
    assert.equal(calc('npv(0.1, -1000, 300, 400, 500)'), -21.0368144252);
    assert.equal(calc('npv(0, 100, 100, 100)'), 300);
    assert.equal(calc('npv(0.05, 100)'), 100);
  });

  it('rejects a discount rate at or below -100%', () => {
    assertCalcError('npv(-1, 100, 100)', { kind: 'math', message: /greater than -100%/ });
  });
});
