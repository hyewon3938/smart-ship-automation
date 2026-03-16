"use client";

import Link from "next/link";

import { BookingSettingsTab } from "@/components/settings/BookingSettingsTab";
import { GsSettingsTab } from "@/components/settings/GsSettingsTab";
import { NaverSettingsTab } from "@/components/settings/NaverSettingsTab";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useSettings } from "@/hooks/useSettings";

export default function SettingsPage() {
  const { data: settings, isLoading, isError } = useSettings();

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-2xl px-4 py-8">
        <div className="mb-6 flex items-center gap-4">
          <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">
            ← 대시보드
          </Link>
          <h1 className="text-2xl font-semibold">설정</h1>
        </div>

        {isError && (
          <p className="text-sm text-destructive">설정을 불러올 수 없습니다.</p>
        )}

        {isLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-48 w-full" />
          </div>
        ) : (
          settings && (
            <Tabs defaultValue="naver">
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="naver">네이버 API</TabsTrigger>
                <TabsTrigger value="gs">GS택배</TabsTrigger>
                <TabsTrigger value="booking">택배 기본값</TabsTrigger>
              </TabsList>
              <Card className="mt-4">
                <CardContent className="pt-6">
                  <TabsContent value="naver">
                    <NaverSettingsTab initial={settings.naver} />
                  </TabsContent>
                  <TabsContent value="gs">
                    <GsSettingsTab initial={settings.gs} />
                  </TabsContent>
                  <TabsContent value="booking">
                    <BookingSettingsTab initial={settings.booking} />
                  </TabsContent>
                </CardContent>
              </Card>
            </Tabs>
          )
        )}
      </div>
    </div>
  );
}
