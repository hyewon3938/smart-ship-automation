"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { requestJson } from "@/lib/api-client";
import type { AllSettings } from "@/types";

export function useSettings() {
  return useQuery<AllSettings>({
    queryKey: ["settings"],
    queryFn: () => requestJson<AllSettings>("/api/settings"),
  });
}

export function useUpdateSettings() {
  const queryClient = useQueryClient();
  return useMutation<AllSettings, Error, Partial<AllSettings>>({
    mutationFn: (data) =>
      requestJson<AllSettings>("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["settings"] });
    },
  });
}

export function useTestNaver() {
  return useMutation<{ success: boolean; message: string }, Error>({
    mutationFn: () =>
      requestJson<{ success: boolean; message: string }>(
        "/api/settings/test-naver",
        { method: "POST" },
      ),
  });
}

export function useTestGs() {
  return useMutation<{ success: boolean; message: string }, Error>({
    mutationFn: () =>
      requestJson<{ success: boolean; message: string }>(
        "/api/settings/test-gs",
        { method: "POST" },
      ),
  });
}
