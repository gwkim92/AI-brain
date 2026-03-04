import { describe, expect, it } from 'vitest';

import { ActionMarketplaceV2 } from '../marketplace';

describe('ActionMarketplaceV2', () => {
  it('registers modules and validates permissions', () => {
    const marketplace = new ActionMarketplaceV2();
    marketplace.registerModule({
      actionKey: 'github.pr.create',
      version: '1.0.0',
      title: 'Create GitHub PR',
      description: 'Open pull requests',
      requiredPermissions: ['github:repo:write']
    });

    const denied = marketplace.authorize({
      actionKey: 'github.pr.create',
      grantedPermissions: []
    });
    expect(denied.allowed).toBe(false);
    expect(denied.missingPermissions).toContain('github:repo:write');

    const allowed = marketplace.authorize({
      actionKey: 'github.pr.create',
      grantedPermissions: ['github:repo:write']
    });
    expect(allowed.allowed).toBe(true);
    expect(allowed.missingPermissions).toHaveLength(0);
  });
});
