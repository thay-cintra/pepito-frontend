import { Outlet } from "react-router-dom";
import { AppSidebar } from "./AppSidebar";

export function Layout() {
  return (
    <div className="flex h-full min-h-screen bg-muted/30">
      <AppSidebar />
      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}
