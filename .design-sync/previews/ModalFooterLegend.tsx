import { ModalFooterLegend } from 'lingua';

export const Default = () => <ModalFooterLegend />;

export const NavigateAndClose = () => <ModalFooterLegend navigate close select={false} />;

export const OpenVariant = () => <ModalFooterLegend navigate open close select={false} />;
