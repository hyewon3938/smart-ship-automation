"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { AllSettings } from "@/types";

export function useSettings() {
  return useQuery<AllSettings>({
    queryKey: ["settings"],
    queryFn: async () => {
      const res = await fetch("/api/settings");
      if (!res.ok) throw new Error("설정 조회 실패");
      return res.json() as Promise<AllSettings>;
    },
  });
}

export function useUpdateSettings() {
  const queryClient = useQueryClient();
  return useMutation<AllSettings, Error, Partial<AllSettings>>({
    mutationFn: async (data) => {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        throw new Error(err.error ?? "설정 저장 실패");
      }
      return res.json() as Promise<AllSettings>;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["settings"] });
    },
  });
}

export function useTestNaver() {
  return useMutation<{ success: boolean; message: string }, Error>({
    mutationFn: async () => {
      const res = await fetch("/api/settings/test-naver", { method: "POST" });
      return res.json() as Promise<{ success: boolean; message: string }>;
    },
  });
}

export function useTestGs() {
  return useMutation<{ success: boolean; message: string }, Error>({
    mutationFn: async () => {
      const res = await fetch("/api/settings/test-gs", { method: "POST" });
      return res.json() as Promise<{ success: boolean; message: string }>;
    },
  });
}
