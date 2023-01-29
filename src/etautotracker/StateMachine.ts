export interface State {
    onEnter?: Function;
    onTick?: Function;
    onExit?: Function;
}

export class StateMachine {
    states: Record<symbol, State>;

    public currentState: State|null;

    public currentStateName: symbol|null;

    constructor() {
        this.states = {};
        this.currentState = null;
        this.currentStateName = null;
    }

    registerState(name: symbol, state: State) {
        this.states[name] = state;
    }

    setState(name: symbol) {
        if (name === this.currentStateName) {
            return;
        }

        this.currentState?.onExit?.call(null);

        this.currentState = this.states[name] ?? null;

        if (this.currentState !== null) {
            this.currentStateName = name;
        }

        this.currentState?.onEnter?.call(null);
    }

    tick() {
        this.currentState?.onTick?.call(null);
    }
}
