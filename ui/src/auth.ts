export async function currentUser(fetcher: typeof fetch = fetch) {
  const response = await fetcher('/auth/me');
  return response.ok;
}

export async function setupUser(email: string, password: string, fetcher: typeof fetch = fetch) {
  return authRequest('/auth/setup', email, password, fetcher);
}

export async function loginUser(email: string, password: string, fetcher: typeof fetch = fetch) {
  return authRequest('/auth/login', email, password, fetcher);
}

export async function logoutUser(fetcher: typeof fetch = fetch) {
  const response = await fetcher('/auth/logout', { method: 'POST' });
  if (!response.ok) {
    throw new Error(await response.text());
  }
}

async function authRequest(url: string, email: string, password: string, fetcher: typeof fetch) {
  const response = await fetcher(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!response.ok) {
    throw new Error(await response.text());
  }
}
