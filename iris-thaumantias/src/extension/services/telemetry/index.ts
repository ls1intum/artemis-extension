// Telemetry services barrel exports
export * from './types';
export { DiagnosticPersistenceService } from './diagnosticPersistenceService';
export { InactivityService } from './inactivityService';
export { ThrashingDetector } from './thrashingDetector';
export { BuildResultTracker } from './buildResultTracker';
export { InterventionService } from './interventionService';
export { InterventionFilter } from './interventionFilter';
export { TelemetryManager } from './telemetryManager';

// New EQ system
export { ErrorQuotientEngine } from './metrics/errorQuotientEngine';
export { CompileEquivalentEmitter, classifyBuildResult } from './eventPipeline/compileEquivalentEmitter';
export { BoundaryTriggerEmitter } from './eventPipeline/boundaryTriggerEmitter';
export { InterventionDecisionEngine } from './decision/interventionDecisionEngine';
export { AdaptiveCadence } from './intervention/adaptiveCadence';

// Recording
export * from './recording';
