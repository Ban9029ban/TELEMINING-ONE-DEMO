import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import axios from "axios";
import Login from "./index";

const mockNavigate = jest.fn();
jest.mock("react-router-dom", () => ({ useNavigate: () => mockNavigate }), { virtual: true });
jest.mock("axios", () => ({ post: jest.fn() }));

beforeEach(() => {
  localStorage.clear();
  mockNavigate.mockReset();
  axios.post.mockResolvedValue({ status: 200, data: { access_token: "test-session", username: "new-user", role: "user" } });
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ allowed: {} }) });
});
afterEach(() => { localStorage.clear(); jest.restoreAllMocks(); });

function submit() {
  render(<Login />);
  fireEvent.change(screen.getByPlaceholderText("Nombre de usuario"), { target: { value: "new-user" } });
  fireEvent.change(screen.getByPlaceholderText("Contraseña"), { target: { value: "test-password" } });
  fireEvent.submit(screen.getByRole("button", { name: "Login" }).closest("form"));
}

test("a valid new user without modules keeps the session and sees the assignment page", async () => {
  submit();
  await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith("/sin-modulos", { replace: true }));
  expect(localStorage.getItem("token")).toBe("test-session");
  expect(localStorage.getItem("role_name")).toBe("user");
});

test("a user assigned only seismic access enters the seismic dashboard", async () => {
  global.fetch.mockResolvedValue({ ok: true, json: async () => ({ allowed: { "sismico:sismico": true } }) });
  submit();
  await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith("/sismico", { replace: true }));
});

test("an incorrect password still denies authentication", async () => {
  axios.post.mockResolvedValue({ status: 401, data: { detail: "Incorrect username or password" } });
  submit();
  expect(await screen.findByText(/No se pudo iniciar sesión/)).toBeInTheDocument();
  expect(mockNavigate).not.toHaveBeenCalled();
  expect(localStorage.getItem("token")).toBeNull();
});
