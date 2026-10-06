import "./App.css";

import { DarkModeProvider } from "./components/DarkModeContext";
import GeneralRoutes from "./routes/General";

function App() {
  return (
    <div className="App">
      <DarkModeProvider>
        <GeneralRoutes />
      </DarkModeProvider>
    </div>);

}

export default App;