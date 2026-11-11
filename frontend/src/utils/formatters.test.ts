import { describe, it, expect } from 'vitest';
import { parseNumeric, formatCurrency, formatPercentage } from './formatters';

describe('Numeric & Currency Formatters', () => {
  describe('parseNumeric', () => {
    it('handles numeric numbers', () => {
      expect(parseNumeric(25.5)).toBe(25.5);
      expect(parseNumeric(0)).toBe(0);
      expect(parseNumeric(-10)).toBe(-10);
    });

    it('handles numeric strings from SQL/PostgreSQL/LocalDB', () => {
      expect(parseNumeric('25.00')).toBe(25);
      expect(parseNumeric('0.8800')).toBe(0.88);
      expect(parseNumeric('0')).toBe(0);
      expect(parseNumeric('0.00')).toBe(0);
      expect(parseNumeric('  12.34  ')).toBe(12.34);
    });

    it('handles null, undefined, and empty strings gracefully', () => {
      expect(parseNumeric(null)).toBeUndefined();
      expect(parseNumeric(undefined)).toBeUndefined();
      expect(parseNumeric('')).toBeUndefined();
      expect(parseNumeric('   ')).toBeUndefined();
    });

    it('handles invalid non-numeric strings without throwing', () => {
      expect(parseNumeric('invalid_amount')).toBeUndefined();
      expect(parseNumeric('NaN')).toBeUndefined();
    });
  });

  describe('formatCurrency', () => {
    it('formats valid numbers and numeric strings', () => {
      expect(formatCurrency(25)).toBe('$25.00');
      expect(formatCurrency('25.00')).toBe('$25.00');
      expect(formatCurrency('199.99')).toBe('$199.99');
    });

    it('preserves genuine zero values', () => {
      expect(formatCurrency(0)).toBe('$0.00');
      expect(formatCurrency('0')).toBe('$0.00');
      expect(formatCurrency('0.00')).toBe('$0.00');
    });

    it('handles null and undefined without crashing, returning em dash by default', () => {
      expect(formatCurrency(null)).toBe('—');
      expect(formatCurrency(undefined)).toBe('—');
      expect(formatCurrency(null, 2, '$0.00')).toBe('$0.00');
    });

    it('handles invalid numeric strings gracefully with em dash fallback', () => {
      expect(formatCurrency('corrupted_val')).toBe('—');
      expect(formatCurrency('invalid')).toBe('—');
      expect(formatCurrency('corrupted_val', 2, 'N/A')).toBe('N/A');
    });
  });

  describe('formatPercentage', () => {
    it('formats decimal numbers and strings to percentage', () => {
      expect(formatPercentage(0.88)).toBe('88%');
      expect(formatPercentage('0.8800')).toBe('88%');
      expect(formatPercentage('1.0')).toBe('100%');
      expect(formatPercentage(0)).toBe('0%');
      expect(formatPercentage('0')).toBe('0%');
    });

    it('handles null and invalid values with fallback', () => {
      expect(formatPercentage(null)).toBe('—');
      expect(formatPercentage(undefined)).toBe('—');
      expect(formatPercentage('invalid')).toBe('—');
      expect(formatPercentage('abc', 'N/A')).toBe('N/A');
      expect(formatPercentage(null, '0%')).toBe('0%');
    });
  });
});
