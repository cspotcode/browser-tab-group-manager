import { observable, computed, configure } from 'mobx';

// --- Decorator detection: prove that we are being transpiled with ES standard decorators, not legacy TS decorators

function detectDecoratorType(...args: any[]) {
  const isStandard = args.length === 2 && typeof args[1] === 'object' && 'kind' in args[1];
  const isLegacy = args.length === 3 || (args.length === 1 && typeof args[0] === 'function');

  if (isStandard) {
    console.log('✅ Using ES Standard Decorators (Stage 3)');
  } else if (isLegacy) {
    console.log('⚠️ Using Legacy Experimental Decorators');
  } else {
    console.log('❓ Unknown decorator format', args.length, args);
  }
}

@detectDecoratorType
class TestDetection {
  @detectDecoratorType
  testMethod() {}
}
void TestDetection;


// --- Plain data types ---

// --- Stores ---

class FooStore {
  @observable accessor field = 1;
  @computed get gettingThisComputedThrowsTheError() {
    return 1;
  }
}

class ThisClassNeverInstantiated {
  @observable accessor fieldOf_ThisClassIsNeverInstantiated: boolean = false;
}

const fooStore = new FooStore();
fooStore.gettingThisComputedThrowsTheError;
