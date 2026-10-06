import { useEffect, useState } from "react";

import {
  getCurrentRoleNames,
  getStoredUserPermissions,
  isAdminRole,
  syncStoredUserPermissions } from
"../utils/accessControl";

export default function useUserPermissions({ syncOnMount = true } = {}) {
  const [permissions, setPermissions] = useState(() => getStoredUserPermissions());
  const [roles, setRoles] = useState(() => getCurrentRoleNames());
  const [ready, setReady] = useState(() => !syncOnMount);

  useEffect(() => {
    let mounted = true;

    const refreshLocal = () => {
      if (!mounted) return;
      setPermissions(getStoredUserPermissions());
      setRoles(getCurrentRoleNames());
    };

    const syncRemote = async () => {
      try {
        const nextPermissions = syncOnMount ? await syncStoredUserPermissions() : getStoredUserPermissions();
        if (!mounted) return;
        setPermissions(nextPermissions || {});
        setRoles(getCurrentRoleNames());
      } finally {
        if (mounted) {
          setReady(true);
        }
      }
    };

    refreshLocal();
    syncRemote();

    window.addEventListener("storage", refreshLocal);
    window.addEventListener("user-permissions-updated", refreshLocal);
    window.addEventListener("auth-updated", refreshLocal);

    return () => {
      mounted = false;
      window.removeEventListener("storage", refreshLocal);
      window.removeEventListener("user-permissions-updated", refreshLocal);
      window.removeEventListener("auth-updated", refreshLocal);
    };
  }, [syncOnMount]);

  return {
    permissions,
    roles,
    ready,
    isAdmin: roles.some(isAdminRole)
  };
}
