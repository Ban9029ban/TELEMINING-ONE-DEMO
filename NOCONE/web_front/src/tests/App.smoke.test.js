import React from "react";
import { render, screen } from "@testing-library/react";

jest.mock("../components/DarkModeContext", () => ({
  DarkModeProvider: ({ children }) => <>{children}</>
}));

jest.mock("../routes/General", () => () => <div>general-routes-mounted</div>);

import App from "../App";

test("App monta el provider y las rutas generales", () => {
  render(<App />);
  expect(screen.getByText("general-routes-mounted")).toBeInTheDocument();
});