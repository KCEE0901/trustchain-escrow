/**
 * Email template for milestone state change notifications
 *
 * Notifies both client and freelancer when a milestone transitions state:
 * Submitted, Approved, Released, Rejected, or Disputed.
 */

function milestoneStateChangedTemplate({ escrowId, milestoneIndex, milestoneTitle, newState, previousState, dashboardUrl }) {
  const stateDescriptions = {
    Submitted: 'work has been submitted for review',
    Approved: 'approval has been received',
    Released: 'funds have been released',
    Rejected: 'submission was rejected and requires resubmission',
    Disputed: 'a dispute has been raised',
  };

  const stateDescription = stateDescriptions[newState] || `state changed to ${newState}`;

  return ({ recipient, unsubscribeUrl, fromName }) => ({
    subject: `Milestone ${milestoneIndex} ${newState.toLowerCase()} - Escrow #${escrowId}`,
    text: [
      `Hello ${recipient.name || recipient.address || 'there'},`,
      '',
      `Milestone ${milestoneIndex}${milestoneTitle ? ` (${milestoneTitle})` : ''} has been updated.`,
      '',
      `New state: ${newState}`,
      `Previous state: ${previousState || 'N/A'}`,
      `Escrow ID: #${escrowId}`,
      '',
      `Details: ${stateDescription}`,
      `View escrow progress here: ${dashboardUrl}`,
      '',
      `Unsubscribe: ${unsubscribeUrl}`,
      '',
      `- ${fromName}`,
    ].join('\n'),
    html: `
      <div style="font-family: Arial, sans-serif; color: #1f2937; line-height: 1.6; max-width: 600px;">
        <h2 style="color: #111827;">Milestone Update</h2>
        <p>Hello ${recipient.name || recipient.address || 'there'},</p>

        <div style="background-color: #f3f4f6; padding: 16px; border-radius: 8px; margin: 20px 0;">
          <p style="margin: 0 0 12px 0;">
            <strong>Milestone ${milestoneIndex}</strong>${milestoneTitle ? ` <em>(${milestoneTitle})</em>` : ''}
            for escrow <strong>#${escrowId}</strong> ${stateDescription}
          </p>

          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="padding: 8px 0; font-weight: 600;">New State:</td>
              <td style="padding: 8px 0; color: #059669;">${newState}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; font-weight: 600;">Previous State:</td>
              <td style="padding: 8px 0;">${previousState || 'N/A'}</td>
            </tr>
          </table>
        </div>

        <p>
          <a href="${dashboardUrl}" style="display: inline-block; background-color: #4f46e5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: 600;">
            View Escrow Progress
          </a>
        </p>

        <p style="font-size: 12px; color: #6b7280; margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb;">
          Need fewer emails? <a href="${unsubscribeUrl}" style="color: #4f46e5;">Unsubscribe from notifications</a>.
        </p>
      </div>
    `,
  });
}

export default milestoneStateChangedTemplate;
