import { K8S_SECRET_PARTIAL_OBJECT_METADATA_LIST_ACCEPT } from '~/consts/secrets';
import { K8sQueryListResourceItems } from '../../../k8s';
import { SecretModel, ServiceAccountModel } from '../../../models';
import { RouterParams } from '../../../routes/utils';
import { createLoaderWithAccessCheck } from '../../../utils/rbac';

export const linkedSecretsListViewLoader = createLoaderWithAccessCheck(
  async ({ params }) => {
    const ns = params[RouterParams.workspaceName];
    return await K8sQueryListResourceItems({
      model: SecretModel,
      queryOptions: { ns, partialObjectMetadata: true },
      fetchOptions: {
        requestInit: {
          headers: { Accept: K8S_SECRET_PARTIAL_OBJECT_METADATA_LIST_ACCEPT },
        },
      },
    });
  },
  { model: ServiceAccountModel, verb: 'patch' },
);
