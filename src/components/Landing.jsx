import Bonfire from './Bonfire'

export default function Landing({ onFindFire, searching, error }) {
  return (
    <div className="landing">
      <div>
        <h1 className="landing-title">laužas</h1>
        <p className="landing-sub">
          Two strangers. One fire. Talk until it burns out.
        </p>
      </div>

      <div className="landing-fire">
        <Bonfire fireScale={1} timeLeft={180} static />
      </div>

      <button
        className="btn-primary"
        onClick={onFindFire}
        disabled={searching}
      >
        {searching
          ? <span>finding a fire<span className="searching-dots" /></span>
          : 'find a fire'}
      </button>

      {error && <p className="error-msg">{error}</p>}
    </div>
  )
}
