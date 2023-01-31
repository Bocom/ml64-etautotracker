export interface State {
    onEnter?: Function;
    onTick?: Function;
    onExit?: Function;
}

export class StateMachine {
    states: Record<symbol, State>;

    public currentState: State|null;

    public currentStateKey: symbol|null;

    constructor(states: Record<symbol, State> = {}) {
        this.states = states;
        this.currentState = null;
        this.currentStateKey = null;
    }

    registerState(key: symbol, state: State) {
        this.states[key] = state;
    }

    setState(key: symbol) {
        if (key === this.currentStateKey) {
            return;
        }

        this.currentState?.onExit?.call(null);

        this.currentState = this.states[key] ?? null;

        if (this.currentState !== null) {
            this.currentStateKey = key;
        }

        this.currentState?.onEnter?.call(null);
    }

    tick() {
        this.currentState?.onTick?.call(null);
    }
}
