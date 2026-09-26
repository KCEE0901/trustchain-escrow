/**
 * Email template: Dispute Ruling Issued
 *
 * Sent to both client and contractor when an arbiter submits a ruling on a
 * disputed escrow.  Matches the structure of disputeRaised.js.
 *
 * @param {object} params
 * @param {string} params.escrowId         - Escrow identifier
 * @param {number} params.clientPct        - Percentage awarded to the client (0–100)
 * @param {number} params.contractorPct    - Percentage awarded to the contractor (0–100)
 * @param {string} [params.resolution]     - Human-readable ruling summary
 * @param {string} params.dashboardUrl     - Deep link to the escrow detail page
 */
function disputeRulingIssuedTemplate({ escrowId, clientPct, contractorPct, resolution, dashboardUrl }) {
  return ({ recipient, unsubscribeUrl, fromName }) => ({
    subject: `Dispute ruling issued for escrow #${escrowId}`,
    text: [
      `Hello ${recipient.name || recipient.address || 'there'},`,
      '',
      `An arbiter has issued a ruling for the dispute on escrow #${escrowId}.`,
      '',
      `Ruling summary:`,
      `  Client receives:     ${clientPct}%`,
      `  Contractor receives: ${contractorPct}%`,
      resolution ? `  Notes: ${resolution}` : '',
      '',
      `View the full ruling here: ${dashboardUrl}`,
      '',
      `Unsubscribe: ${unsubscribeUrl}`,
      '',
      `- ${fromName}`,
    ]
      .filter((line) => line !== undefined)
      .join('\n'),
    html: `
      <div style="font-family: Arial, sans-serif; color: #1f2937; line-height: 1.6;">
        <h2>Dispute ruling issued</h2>
        <p>Hello ${recipient.name || recipient.address || 'there'},</p>
        <p>
          An arbiter has issued a ruling for the dispute on escrow
          <strong>#${escrowId}</strong>.
        </p>
        <table style="border-collapse: collapse; margin: 12px 0;">
          <tr>
            <td style="padding: 4px 16px 4px 0; font-weight: bold;">Client receives</td>
            <td style="padding: 4px 0;">${clientPct}%</td>
          </tr>
          <tr>
            <td style="padding: 4px 16px 4px 0; font-weight: bold;">Contractor receives</td>
            <td style="padding: 4px 0;">${contractorPct}%</td>
          </tr>
          ${resolution ? `
          <tr>
            <td style="padding: 4px 16px 4px 0; font-weight: bold; vertical-align: top;">Notes</td>
            <td style="padding: 4px 0;">${resolution}</td>
          </tr>` : ''}
        </table>
        <p><a href="${dashboardUrl}">View full ruling details</a></p>
        <p style="font-size: 12px; color: #6b7280;">Need fewer emails? <a href="${unsubscribeUrl}">Unsubscribe</a>.</p>
      </div>
    `,
  });
}

export default disputeRulingIssuedTemplate;
