import { describe, expect, it } from 'vitest';
import { headersFromStencilYaml } from './stencil';

describe('headersFromStencilYaml', () => {
  it('turns fields and table columns into unique Sheetbase headers', () => {
    const result = headersFromStencilYaml(`
name: lab_report
discriminator:
  cells: [A1]
versions:
  "v1.0":
    fields:
      patient_name:
        cell: B3
      results_table:
        range: A10:D
        type: table
        columns:
          A: Analyte
          B: Result
          C: Units
      sample_date:
        cell: B4
`);

    expect(result.name).toBe('lab_report');
    expect(result.headers).toEqual(['Patient Name', 'Analyte', 'Result', 'Units', 'Sample Date']);
  });

  it('can import a preferred version', () => {
    const result = headersFromStencilYaml(`
name: invoice
versions:
  "v1.0":
    fields:
      old_total: { cell: B2 }
  "v2.0":
    fields:
      customer_name: { cell: A2 }
      total_amount: { cell: B2 }
`, 'v2.0');

    expect(result.headers).toEqual(['Customer Name', 'Total Amount']);
  });

  it('rejects computed fields', () => {
    expect(() => headersFromStencilYaml(`
name: computed
versions:
  "v1.0":
    fields:
      total:
        type: computed
`)).toThrow('Unsupported Stencil field total');
  });

  it('rejects unnamed ranges', () => {
    expect(() => headersFromStencilYaml(`
name: range
versions:
  "v1.0":
    fields:
      line_items:
        range: A10:D
`)).toThrow('ranges need named columns');
  });
});
