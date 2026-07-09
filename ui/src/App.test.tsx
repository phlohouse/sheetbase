import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from './App';

describe('App', () => {
  it('supports the local Sheet Form editing lifecycle', () => {
    render(<App />);

    fireEvent.change(screen.getByLabelText('Header 3'), { target: { value: 'Source list' } });
    expect(screen.getByDisplayValue('Source list')).toBeTruthy();

    fireEvent.change(screen.getAllByLabelText('Company value')[0], { target: { value: 'Acme Labs' } });
    fireEvent.change(screen.getAllByLabelText('Domain value')[0], { target: { value: 'acme.test' } });
    expect(screen.getByDisplayValue('Acme Labs')).toBeTruthy();
    expect(screen.getByDisplayValue('acme.test')).toBeTruthy();

    const companyInputs = screen.getAllByLabelText('Company value');
    fireEvent.change(companyInputs.at(-1)!, { target: { value: 'NewCo' } });
    expect(screen.getAllByLabelText('Company value').length).toBeGreaterThan(companyInputs.length);

    fireEvent.click(screen.getByLabelText('Add column'));
    expect(screen.getByLabelText('Header 7')).toBeTruthy();
  });
});
