jest.mock("../components/Layout", () => () => <div data-testid="layout-shell">layout-shell</div>);

jest.mock("../pages/Login", () => () => <div>login-page</div>);
jest.mock("../pages/Logout", () => () => <div>logout-page</div>);
jest.mock("../pages/Home", () => () => <div>home-page</div>);
jest.mock("../pages/ChartsPage", () => () => <div>charts-page</div>);
jest.mock("../pages/Lobby", () => () => <div>lobby-page</div>);
jest.mock("../pages/Admin", () => () => <div>admin-page</div>);
jest.mock("../pages/Agents", () => () => <div>agents-page</div>);
jest.mock("../pages/Access", () => () => <div>access-page</div>);
jest.mock("../pages/Cameras", () => () => <div>cameras-page</div>);
jest.mock("../pages/Cameras/nok_camaras", () => () => <div>cameras-nok-page</div>);
jest.mock("../pages/Cameras/ver_camaras", () => () => <div>cameras-ver-page</div>);
jest.mock("../pages/Config", () => () => <div>config-page</div>);
jest.mock("../pages/Sismico", () => () => <div>sísmico-page</div>);
jest.mock("../pages/SemaforosVial", () => () => <div>semáforos-page</div>);