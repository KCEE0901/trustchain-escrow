const PENDING_STEP = 0;
const ACTIVE_STEP = 1;
const COMPLETE_STEP = 2;

export default function MilestoneTracker({ milestones = [] }) {
  const getStep = (status) => {
    switch (status) {
      case 'active':
        return ACTIVE_STEP;
      case 'complete':
        return COMPLETE_STEP;
      default:
        return PENDING_STEP;
    }
  };

  return (
    <div className="milestone-tracker">
      {milestones.map((milestone, index) => (
        <div key={milestone.id ?? index} data-step={getStep(milestone.status)}>
          {milestone.title ?? `Milestone ${index + 1}`}
        </div>
      ))}
    </div>
  );
}
