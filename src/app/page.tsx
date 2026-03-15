export default function Home() {
  return (
    <main className="container mx-auto p-6">
      <h1 className="text-2xl font-bold mb-4">Smart Ship Automation</h1>
      <p className="text-muted-foreground">
        네이버 스마트스토어 주문 → GS택배 자동 예약
      </p>
      <div className="mt-8 p-4 border rounded-lg">
        <p className="text-sm text-muted-foreground">
          Phase 2에서 주문 목록이 여기에 표시됩니다.
        </p>
      </div>
    </main>
  );
}
