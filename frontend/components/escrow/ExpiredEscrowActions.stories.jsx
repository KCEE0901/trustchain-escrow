import ExpiredEscrowActions from './ExpiredEscrowActions';

export default { title: 'Escrow/ExpiredEscrowActions', component: ExpiredEscrowActions };
export const Client = { args: { role: 'client', status: 'Expired', initialState: { recovered: false }, onRecover: async () => ({ recovered: true }) } };
export const Observer = { args: { role: 'observer', status: 'Expired', initialState: { recovered: false }, onRecover: async () => ({ recovered: true }) } };
export const MobileFailure = { ...Client, parameters: { viewport: { defaultViewport: 'mobile1' } }, args: { ...Client.args, onRecover: async () => { throw new Error('unavailable'); } } };
