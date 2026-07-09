import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Root } from './Root';

describe('Root', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('shows auth screen when the session is missing and logs in', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      if (String(input) === '/auth/me') {
        return new Response('', { status: 401 });
      }
      return new Response('{}', { status: 200 });
    }));

    render(<Root />);

    expect(await screen.findByText('Create first admin')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'admin@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'long-enough-password' } });
    fireEvent.click(screen.getByText('Create first admin'));

    expect(await screen.findByRole('heading', { name: 'Companies' })).toBeTruthy();
  });
});
