import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AppHeader } from "../AppHeader";

// Clerk's UserButton is replaced with a stub so the header renders in jsdom.
vi.mock("@clerk/clerk-react", () => ({
  UserButton: () => <div>user-button</div>,
}));

describe("AppHeader", () => {
  it("renders the title, nav link, and the Clerk user button", () => {
    render(
      <MemoryRouter>
        <AppHeader navLinks={[{ to: "/memory", label: "Memory" }]} />
      </MemoryRouter>
    );

    expect(screen.getByText("AI Chatbot")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Memory" })).toBeInTheDocument();
    expect(screen.getByText("user-button")).toBeInTheDocument();
  });
});
