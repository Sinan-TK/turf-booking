-- A venue owner who signs themselves up waits for the Super Admin to approve the account (PENDING_APPROVAL) before the portal shows anything real; a refused one is REJECTED.
ALTER TYPE "OwnerOrganizationStatus" ADD VALUE IF NOT EXISTS 'PENDING_APPROVAL';
ALTER TYPE "OwnerOrganizationStatus" ADD VALUE IF NOT EXISTS 'REJECTED';
