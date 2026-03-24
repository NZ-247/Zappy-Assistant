export interface ScopedResolver {
  (input: { tenantId: string; waUserId: string; waGroupId?: string }): Promise<{
    user: { id: string } | null;
    group: { id: string } | null;
  }>;
}
