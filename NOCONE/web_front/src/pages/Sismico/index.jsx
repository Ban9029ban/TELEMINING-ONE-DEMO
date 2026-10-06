const SISMICO_URL = "http://devtm.denial.cl:15173/legacy-sismico";

const Sismico = () => (
  <iframe
    title="Semáforos sísmicos"
    src={SISMICO_URL}
    allowFullScreen
    className="h-screen w-full border-0"
    referrerPolicy="no-referrer"
  />
);

export default Sismico;
