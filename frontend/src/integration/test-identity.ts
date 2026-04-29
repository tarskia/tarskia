export interface TestIdentity {
  email: string;
  memberId: string;
  organizationId: string;
}

const normalizeSlug = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24);

export const createTestIdentity = (label: string): TestIdentity => {
  const slug = normalizeSlug(label) || 'integration';
  const nonce = crypto.randomUUID().slice(0, 8);
  return {
    organizationId: `org-${slug}-${nonce}`,
    memberId: `member-${slug}-${nonce}`,
    email: `${slug}-${nonce}@integration.diagram.dev`,
  };
};

export const withTestIdentity = (
  identity: TestIdentity,
  request: RequestInit = {},
): RequestInit => ({
  ...request,
  headers: {
    ...(request.headers ?? {}),
    'X-Test-Organization-Id': identity.organizationId,
    'X-Test-Member-Email': identity.email,
    'X-Test-Member-Id': identity.memberId,
  },
});
