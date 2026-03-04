import React, { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink, splitLink, createWSClient, wsLink } from "@trpc/client";
import { trpc } from "../trpc.js";

type TRPCProviderProps = {
  children: React.ReactNode;
  apiUrl: string;
  getAccessToken: () => Promise<string>;
};

function deriveWsUrl(apiUrl: string): string {
  if (apiUrl.startsWith("/")) {
    if (typeof window === "undefined") return "ws://localhost:3001/api/trpc";
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${window.location.host}${apiUrl}`;
  }
  return apiUrl.replace(/^http/, "ws");
}

export function TRPCProvider({ children, apiUrl, getAccessToken }: TRPCProviderProps) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 5 * 60 * 1000,
            retry: 1,
          },
        },
      })
  );

  const [trpcClient] = useState(() => {
    const wsClient = createWSClient({
      url: deriveWsUrl(apiUrl),
      connectionParams: async () => {
        try {
          const token = await getAccessToken();
          return { token };
        } catch {
          return {};
        }
      },
    });

    return trpc.createClient({
      links: [
        splitLink({
          condition: (op) => op.type === "subscription",
          true: wsLink({ client: wsClient }),
          false: httpBatchLink({
            url: apiUrl,
            async headers() {
              try {
                const token = await getAccessToken();
                return { Authorization: `Bearer ${token}` };
              } catch {
                return {};
              }
            },
          }),
        }),
      ],
    });
  });

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </trpc.Provider>
  );
}
