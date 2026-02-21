export default function Landing({ onFindFire, searching, error }) {
  return (
    <div className="landing">
      <div>
        <h1 className="landing-title">laužas</h1>
        <p className="landing-sub">
          Du nepažįstami. Vienas laužas. Kalbėkite kol jis užgęsta.
        </p>
      </div>

      <button
        className="btn-primary"
        onClick={onFindFire}
        disabled={searching}
      >
        {searching
          ? <span>ieškoma laužo<span className="searching-dots" /></span>
          : 'rasti laužą'}
      </button>

      {error && <p className="error-msg">{error}</p>}
    </div>
  )
}
