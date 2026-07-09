import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Root } from './Root';

describe('Root', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
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

    expect(await screen.findByDisplayValue('Companies')).toBeTruthy();
  });

  it('signs out and returns to the auth screen', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      calls.push(String(input));
      if (String(input) === '/auth/me') {
        return new Response('{}', { status: 200 });
      }
      return new Response('', { status: 200 });
    }));

    render(<Root />);

    fireEvent.click(await screen.findByRole('button', { name: 'Sign out' }));

    expect(await screen.findByText('Create first admin')).toBeTruthy();
    expect(calls).toContain('/auth/logout');
  });
});
