import { useRef, useEffect } from "react";
import { trpc } from "../trpc.js";

export function useSessionSync(user: { name?: string; email?: string } | null) {
  const created = useRef(false);

  const me = trpc.user.me.useQuery(undefined, {
    enabled: !!user?.email,
    retry: 2,
    retryDelay: 1000,
  });

  const createUser = trpc.user.create.useMutation({
    onSuccess: () => { me.refetch(); },
  });

  useEffect(() => {
    if (!user?.email || !me.isSuccess || me.data || created.current) return;
    created.current = true;
    createUser.mutate({ name: user.name ?? user.email!, email: user.email! });
  }, [user?.email, me.isSuccess, me.data]);

  return !!me.data;
}
