import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { vi, describe, it, expect } from "vitest";
import { Calls } from "@/pages/Calls";

vi.mock("@/lib/api", () => ({
  getCalls: vi.fn().mockResolvedValue([
    {
      id: "c1",
      personEmail: "colleen@example.com",
      toNumber: "+37491452889",
      status: "ended",
      durationSec: 83,
      summary: "Confirmed the interview for Tuesday.",
      createdAt: new Date().toISOString(),
    },
  ]),
  getCall: vi.fn(),
}));

vi.mock("@clerk/clerk-react", () => ({
  useAuth: () => ({ getToken: async () => "tok" }),
  UserButton: () => <div>user-button</div>,
}));

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

describe("Calls page", () => {
  it("renders a call returned by getCalls", async () => {
    render(<Calls />, { wrapper });
    expect(await screen.findByText("colleen@example.com")).toBeInTheDocument();
    expect(await screen.findByText("Confirmed the interview for Tuesday.")).toBeInTheDocument();
  });
});
